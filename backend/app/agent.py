"""The council-officer agent: OpenAI Agents SDK on TensorX, tools over MCP.

stream_agent(question) yields (event, data) pairs, the contract's POST /api/agent/ask stream:
  tool_call   {id, name, args}
  tool_result {id, name, ms, db_op, summary}      ms and db_op come from the tool's trace
  delta       {text}
  done        {text}                              {text, error: true} if the run failed
"""
import asyncio
import json
import logging
import os
from typing import Any, AsyncIterator

from agents import Agent, ModelSettings, OpenAIChatCompletionsModel, Runner, set_tracing_disabled
from agents.mcp import MCPServerStreamableHttp
from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai.types.responses import ResponseTextDeltaEvent

from app.llm import model_from_env

load_dotenv()
set_tracing_disabled(True)  # no OpenAI key at runtime: nothing may be sent to OpenAI tracing
log = logging.getLogger("agent")

MCP_URL = "http://127.0.0.1:8001/mcp"
MAX_TURNS = 8
RUN_TIMEOUT_S = 120

INSTRUCTIONS = """You are the HomesAbove assistant for a council or town regeneration officer.
HomesAbove ranks buildings whose upper floors look underused. Each facade photo is read by one AI model, \
checked by a second, independent model that sees only the upper floors, and scored on services within \
walking distance. You are read-only: you recommend where to look first; only humans record labels and \
inspections.

Rules:
- Always use the tools. Never answer from memory. Call street_candidates to say where to look first, \
building to explain a building, services_nearby for services, review_queue for what needs a human check, \
similar_facades for look-alike facades, grant_info for grant questions.
- Call tools first without writing any text, then write one final answer.
- To say where to look first: call street_candidates, then call building and services_nearby for the top \
candidate to check its evidence and services before you answer. To explain a rank: call building and \
services_nearby for that building.
- Say "likely underused" and "candidate for inspection". Never say "vacant" or "empty".
- For every building you mention, write its id exactly as the tool returned it (for example talbot_12), \
its rank, the evidence sentence, and "services X/5 within walking distance". If the two model passes \
disagree, say what the verifier saw.
- A building with status "review" is waiting for a human because the two passes disagree or confidence is \
low. Say that a human decides.
- Every candidate needs human verification: say so in one short sentence.
- Never say whether a building or an owner qualifies for the grant. Give the amounts and the official FAQ \
link from grant_info, nothing more.
- If a tool says something is not available or not checked yet, say so plainly.
- Keep it short: at most 8 lines of plain text, no tables."""


def build_agent(mcp_server: Any) -> Agent:
    client = AsyncOpenAI(base_url=os.environ["TENSORX_BASE_URL"], api_key=os.environ["TENSORX_API_KEY"])
    model = OpenAIChatCompletionsModel(model=model_from_env("AGENT_MODEL"), openai_client=client)
    return Agent(name="HomesAbove", instructions=INSTRUCTIONS, model=model,
                 model_settings=ModelSettings(temperature=0), mcp_servers=[mcp_server])


def _field(obj: Any, name: str) -> Any:
    return obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)


def parse_tool_output(output: Any) -> dict:
    """The tool's JSON result as a dict, whatever shape the SDK hands back."""
    if isinstance(output, dict) and "text" in output and "type" in output:
        output = output["text"]
    if isinstance(output, list) and output:
        output = _field(output[0], "text") or output[0]
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except ValueError:
            return {"summary": output}
    return output if isinstance(output, dict) else {"summary": str(output)}


def tool_result_event(call_id: str, name: str, output: Any) -> dict:
    data = parse_tool_output(output)
    trace = data.get("trace") or {}
    summary = data.get("summary") or data.get("error") or json.dumps(data)[:200]
    return {"id": call_id, "name": name, "ms": trace.get("ms"), "db_op": trace.get("db_op", "error"),
            "summary": str(summary)[:200]}


async def stream_with_server(server: Any, question: str) -> AsyncIterator[tuple[str, dict]]:
    """Run the agent against an already connected MCP server and yield the contract's events."""
    names: dict[str, str] = {}  # call_id -> tool name
    started = False  # the model often opens with blank lines: drop them
    result = Runner.run_streamed(build_agent(server), question, max_turns=MAX_TURNS)
    async for ev in result.stream_events():
        if ev.type == "raw_response_event":
            if isinstance(ev.data, ResponseTextDeltaEvent):
                text = ev.data.delta if started else ev.data.delta.lstrip()
                if text:
                    started = True
                    yield "delta", {"text": text}
        elif ev.type == "run_item_stream_event" and ev.name == "tool_called":
            raw = ev.item.raw_item
            call_id, name = _field(raw, "call_id"), _field(raw, "name")
            names[call_id] = name
            yield "tool_call", {"id": call_id, "name": name, "args": json.loads(_field(raw, "arguments") or "{}")}
        elif ev.type == "run_item_stream_event" and ev.name == "tool_output":
            call_id = _field(ev.item.raw_item, "call_id")
            yield "tool_result", tool_result_event(call_id, names.get(call_id, "?"), ev.item.output)
    yield "done", {"text": str(result.final_output or "").strip()}


async def stream_agent(question: str) -> AsyncIterator[tuple[str, dict]]:
    """The API's agent: tools over the MCP server on 127.0.0.1:8001."""
    try:
        async with asyncio.timeout(RUN_TIMEOUT_S):
            async with MCPServerStreamableHttp({"url": MCP_URL}, cache_tools_list=True,
                                               client_session_timeout_seconds=30) as server:
                async for event in stream_with_server(server, question):
                    yield event
    except Exception as exc:  # the officer sees the failure instead of a stalled stream
        log.exception("agent run failed")
        yield "done", {"text": f"The agent could not complete this request ({type(exc).__name__}: {str(exc)[:160]}).",
                       "error": True}
