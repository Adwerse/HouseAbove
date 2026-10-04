"""The one adapter to TensorX (OpenAI-compatible). chat.completions only.

structured() sends a prompt (optionally with one image as a data URL) and
returns a validated Pydantic object. Output format, best first:
  1. response_format json_schema strict (the probe showed every vision model supports it)
  2. response_format json_object, schema in the system prompt
  3. no response_format, schema in the system prompt
A model is moved down the list for the rest of the process when the endpoint
rejects the format with a 400.
Validation failure: retry once with the error appended; still invalid ->
LLMResult.value is None and the caller marks the building unclear.
"""
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Generic, TypeVar

from dotenv import load_dotenv
from openai import AsyncOpenAI, BadRequestError
from pydantic import BaseModel, ValidationError

load_dotenv()
log = logging.getLogger("llm")

T = TypeVar("T", bound=BaseModel)

_client: AsyncOpenAI | None = None
_format_level: dict[str, int] = {}  # model -> index into the format list, 0 = json_schema strict


@dataclass
class LLMResult(Generic[T]):
    value: T | None
    model: str  # model id that produced (or failed to produce) the value
    attempts: int
    error: str | None = None
    raw: str | None = None  # last raw reply, for debugging


def model_from_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set: put the probe_providers.py output in .env")
    return value


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            base_url=os.environ["TENSORX_BASE_URL"],
            api_key=os.environ["TENSORX_API_KEY"],
            max_retries=3,
            timeout=120,
        )
    return _client


def strict_schema(model: type[BaseModel]) -> dict:
    """JSON schema in the shape strict structured output wants: every property
    required, additionalProperties false, no defaults or titles."""

    def fix(node) -> None:
        if not isinstance(node, dict):
            return
        node.pop("title", None)
        node.pop("default", None)
        if "properties" in node:
            node["additionalProperties"] = False
            node["required"] = list(node["properties"])
            for sub in node["properties"].values():
                fix(sub)
        fix(node.get("items"))
        for key in ("anyOf", "allOf", "oneOf"):
            for sub in node.get(key, []):
                fix(sub)
        for sub in node.get("$defs", {}).values():
            fix(sub)

    schema = model.model_json_schema()
    fix(schema)
    return schema


def _formats(schema: type[BaseModel]) -> list[tuple[dict | None, bool]]:
    """(response_format, schema_goes_in_the_system_prompt), best first."""
    strict = {"type": "json_schema",
              "json_schema": {"name": schema.__name__, "strict": True, "schema": strict_schema(schema)}}
    return [(strict, False), ({"type": "json_object"}, True), (None, True)]


def _with_schema_prompt(messages: list[dict], schema: type[BaseModel]) -> list[dict]:
    note = ("\n\nReply with a single JSON object, nothing else, that matches this JSON Schema:\n"
            + json.dumps(strict_schema(schema)))
    first, rest = messages[0], messages[1:]
    return [{**first, "content": first["content"] + note}, *rest]


def _rejects_response_format(exc: BadRequestError) -> bool:
    return bool(re.search(r"response_format|json_schema|json_object|schema|structured", str(exc), re.I))


async def _complete(model: str, messages: list[dict], schema: type[BaseModel]) -> str:
    formats = _formats(schema)
    level = _format_level.get(model, 0)
    while True:
        response_format, schema_in_prompt = formats[level]
        sent = _with_schema_prompt(messages, schema) if schema_in_prompt else messages
        kwargs = {"response_format": response_format} if response_format else {}
        try:
            resp = await get_client().chat.completions.create(model=model, messages=sent, **kwargs)
            return resp.choices[0].message.content or ""
        except BadRequestError as exc:
            if level + 1 >= len(formats) or not _rejects_response_format(exc):
                raise
            level += 1
            _format_level[model] = level
            log.warning("%s rejected the structured format, falling back to level %d: %s",
                        model, level, str(exc)[:160])


def _extract_json(text: str) -> str:
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 and end > start else text


def _describe(exc: ValidationError) -> str:
    lines = [f"{'.'.join(str(p) for p in e['loc']) or 'output'}: {e['msg']}" for e in exc.errors()]
    return "; ".join(lines)[:500]


async def structured(model: str, system: str, user_text: str, schema: type[T],
                     image_url: str | None = None) -> LLMResult[T]:
    """Raises on transport or API errors (after the SDK's own retries). Returns
    value=None only when the model answered twice without valid output."""
    content: str | list[dict] = user_text
    if image_url:
        content = [{"type": "text", "text": user_text},
                   {"type": "image_url", "image_url": {"url": image_url}}]
    messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": content}]

    raw, error = "", ""
    for attempt in (1, 2):
        raw = await _complete(model, messages, schema)
        try:
            return LLMResult(schema.model_validate_json(_extract_json(raw)), model, attempt, raw=raw)
        except ValidationError as exc:
            error = _describe(exc)
            log.warning("%s attempt %d invalid: %s", model, attempt, error)
            messages = [*messages, {"role": "assistant", "content": raw or "(empty)"},
                        {"role": "user", "content": f"That reply was not valid: {error}. "
                                                    "Reply again with only the corrected JSON object."}]
    return LLMResult(None, model, 2, error=error, raw=raw)
