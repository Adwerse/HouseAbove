#!/usr/bin/env python3
"""The council-officer agent in a terminal: the backup for the demo.

    python pipeline/agent_cli.py                    ask questions interactively (empty line quits)
    python pipeline/agent_cli.py --ask "Where on Talbot Street should we inspect first?"

Same agent as POST /api/agent/ask, but it starts its own MCP server over stdio
(backend/mcp_server.py --stdio), so only Atlas and TensorX are needed: not the
API and not the HTTP MCP server. Tool calls are shown as they happen.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from agents.mcp import MCPServerStdio  # noqa: E402

from app.agent import stream_with_server  # noqa: E402


def show(event: str, data: dict) -> None:
    if event == "tool_call":
        print(f"\n  > {data['name']}({', '.join(f'{k}={v!r}' for k, v in data['args'].items())})")
    elif event == "tool_result":
        print(f"    {data['db_op']}, {data['ms']} ms: {data['summary']}")
    elif event == "delta":
        print(data["text"], end="", flush=True)
    elif event == "done":
        print("\n" if not data.get("error") else f"\n{data['text']}\n")


async def ask(server, question: str) -> None:
    try:
        async for event, data in stream_with_server(server, question):
            show(event, data)
    except Exception as exc:
        print(f"\nThe agent could not complete this request ({type(exc).__name__}: {str(exc)[:160]}).\n")


async def main_async(args) -> None:
    params = {"command": sys.executable, "args": [str(ROOT / "backend" / "mcp_server.py"), "--stdio"],
              "env": dict(os.environ)}
    async with MCPServerStdio(params, cache_tools_list=True, client_session_timeout_seconds=30) as server:
        if args.ask:
            await ask(server, args.ask)
            return
        print("HomesAbove agent (read-only; every candidate needs human verification). Empty line to quit.")
        while True:
            question = (await asyncio.to_thread(input, "\nask> ")).strip()
            if not question:
                return
            await ask(server, question)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ask", help="ask one question and exit")
    try:
        asyncio.run(main_async(ap.parse_args()))
    except (EOFError, KeyboardInterrupt):
        print()


if __name__ == "__main__":
    main()
