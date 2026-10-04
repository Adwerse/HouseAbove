#!/usr/bin/env python3
"""Probe TensorX (OpenAI-compatible) and pick a model for each role.

    python pipeline/probe_providers.py [--trials 5] [--workers 4] [--models a,b,c]

Needs TENSORX_BASE_URL and TENSORX_API_KEY (repo-root .env or the environment).
For every chat model listed by GET /models it checks:
  vision       image as a data-URL image_url content part; must name the colour
               of a square in two generated images
  json_schema  response_format json_schema strict (with the image for vision
               models, text-only otherwise); must return valid JSON, right value
  tools        N identical tool-calling requests; each must call
               search_buildings with valid args

Role rules (override with --vision / --verifier / --agent):
  VISION_MODEL    vision + json_schema, fastest
  VERIFIER_MODEL  vision + json_schema, a different family than VISION_MODEL
  AGENT_MODEL     tools N/N; a gpt-oss model wins, then lowest median latency
  EMBED_MODEL     first TensorX embedding model that answers /embeddings,
                  else local fastembed BAAI/bge-small-en-v1.5 (384 dims),
                  written as "fastembed:BAAI/bge-small-en-v1.5"
Results are also saved to data/cache/probe_providers.json.
"""
import argparse
import base64
import io
import json
import os
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

LOCAL_EMBED = ("BAAI/bge-small-en-v1.5", 384)
EMBED_RE = re.compile(r"embed|bge|e5-|gte-|nomic|minilm|mxbai", re.I)
NON_CHAT_RE = re.compile(
    EMBED_RE.pattern + r"|whisper|tts|rerank|moderation|dall-e|flux|stable-diffusion|sdxl|transcri|speech",
    re.I,
)

# Family = the lab that trained the model; first match wins.
FAMILIES = [
    (r"gpt-|chatgpt|(^|/)o[134](-|$)", "openai"),
    (r"claude", "anthropic"),
    (r"gemini|gemma", "google"),
    (r"llama", "meta"),
    (r"qwen|qwq", "qwen"),
    (r"mistral|mixtral|pixtral|ministral|magistral|devstral", "mistral"),
    (r"deepseek", "deepseek"),
    (r"glm", "zhipu"),
    (r"kimi|moonshot", "moonshot"),
    (r"grok", "xai"),
    (r"phi-", "microsoft"),
    (r"nemotron", "nvidia"),
    (r"command", "cohere"),
    (r"granite", "ibm"),
    (r"minimax", "minimax"),
]

COLORS = ["red", "green", "blue", "yellow", "black", "white"]
RGB = {"red": (220, 30, 30), "green": (30, 160, 60), "blue": (30, 60, 220),
       "yellow": (240, 210, 30), "black": (0, 0, 0), "white": (255, 255, 255)}
# (background, square) -> the model must report the square colour
IMAGE_CASES = [("yellow", "blue"), ("white", "red")]

COLOR_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "square_color",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"color": {"type": "string", "enum": COLORS}},
            "required": ["color"],
            "additionalProperties": False,
        },
    },
}

TOOLS = [
    {"type": "function", "function": {
        "name": "search_buildings",
        "description": "Search vacant buildings by street name.",
        "parameters": {
            "type": "object",
            "properties": {"street": {"type": "string"}, "limit": {"type": "integer"}},
            "required": ["street", "limit"],
            "additionalProperties": False,
        }}},
    {"type": "function", "function": {
        "name": "get_building",
        "description": "Get one building by its id.",
        "parameters": {
            "type": "object",
            "properties": {"building_id": {"type": "string"}},
            "required": ["building_id"],
        }}},
]
TOOL_MESSAGES = [
    {"role": "system", "content": "You are a property research agent. Use the tools to answer."},
    {"role": "user", "content": "Find 3 buildings on Moore Street."},
]


def family_of(model_id: str, owned_by: str | None = None) -> str:
    low = model_id.lower()
    for pattern, family in FAMILIES:
        if re.search(pattern, low):
            return family
    if owned_by and owned_by.lower() not in ("", "system", "tensorx", "organization"):
        return owned_by.lower()
    return re.split(r"[-_:.]", low.rsplit("/", 1)[-1])[0]


def image_url(background: str, square: str) -> str:
    img = Image.new("RGB", (224, 224), RGB[background])
    ImageDraw.Draw(img).rectangle((56, 56, 168, 168), fill=RGB[square])
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def image_message(text: str, background: str, square: str) -> list[dict]:
    return [{"role": "user", "content": [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": image_url(background, square)}},
    ]}]


def short_err(exc: Exception) -> str:
    return f"{type(exc).__name__}: {str(exc)[:160]}".replace("\n", " ")


def chat(client: OpenAI, model: str, **kw):
    return client.chat.completions.create(model=model, timeout=90, **kw)


def probe_vision(client, model, r):
    t0 = time.time()
    try:
        for background, square in IMAGE_CASES:
            resp = chat(client, model, messages=image_message(
                "What colour is the square in the middle of this image? Answer with one word.",
                background, square))
            words = re.findall(r"[a-z]+", (resp.choices[0].message.content or "").lower())
            if square not in words:
                r["errors"]["vision"] = f"expected {square!r}, got {' '.join(words)[:80]!r}"
                return
        r["vision"] = True
        r["vision_ms"] = int((time.time() - t0) * 1000 / len(IMAGE_CASES))
    except Exception as exc:
        r["errors"]["vision"] = short_err(exc)


def probe_json_schema(client, model, r):
    try:
        if r["vision"]:
            messages = image_message("Which colour is the square in the middle?", "yellow", "blue")
        else:
            messages = [{"role": "user", "content": "Which colour is a clear daytime sky?"}]
        resp = chat(client, model, messages=messages, response_format=COLOR_FORMAT)
        data = json.loads(resp.choices[0].message.content or "")
        if set(data) == {"color"} and data["color"] == "blue":
            r["json_schema"] = True
        else:
            r["errors"]["json_schema"] = f"unexpected output {data!r}"[:160]
    except Exception as exc:
        r["errors"]["json_schema"] = short_err(exc)


def tool_call_valid(resp) -> str | None:
    """None if the response is a valid search_buildings call, else the reason."""
    calls = resp.choices[0].message.tool_calls or []
    if not calls:
        return "no tool call"
    fn = calls[0].function
    if fn.name != "search_buildings":
        return f"wrong tool {fn.name!r}"
    try:
        args = json.loads(fn.arguments)
    except ValueError:
        return "arguments are not JSON"
    if not (isinstance(args, dict) and isinstance(args.get("street"), str)
            and "moore" in args["street"].lower()
            and isinstance(args.get("limit"), int) and not isinstance(args["limit"], bool)
            and args["limit"] == 3):
        return f"bad arguments {args!r}"[:160]
    return None


def probe_tools(client, model, r, trials):
    latencies = []
    for _ in range(trials):
        t0 = time.time()
        try:
            resp = chat(client, model, messages=TOOL_MESSAGES, tools=TOOLS, tool_choice="auto")
            problem = tool_call_valid(resp)
        except Exception as exc:
            problem = short_err(exc)
        if problem is None:
            r["tools_ok"] += 1
            latencies.append(int((time.time() - t0) * 1000))
        else:
            r["errors"].setdefault("tools", problem)
    r["tools_ms"] = int(statistics.median(latencies)) if latencies else None


def probe_model(client, model_id, owned_by, trials):
    r = {"id": model_id, "family": family_of(model_id, owned_by), "vision": False,
         "json_schema": False, "tools_ok": 0, "trials": trials, "errors": {}}
    probe_vision(client, model_id, r)
    probe_json_schema(client, model_id, r)
    probe_tools(client, model_id, r, trials)
    print(f"  done {model_id}", file=sys.stderr)
    return r


def probe_embeddings(client, model_ids, preset):
    """-> (model, dim, errors). Falls back to local fastembed."""
    errors = {}
    candidates = [m for m in model_ids if EMBED_RE.search(m)]
    if preset and preset not in candidates and not preset.startswith("fastembed:"):
        candidates.append(preset)
    for model in candidates:
        try:
            resp = client.embeddings.create(model=model, input=["a terraced house on Moore Street"], timeout=60)
            return model, len(resp.data[0].embedding), errors
        except Exception as exc:
            errors[model] = short_err(exc)
    name, dim = LOCAL_EMBED
    try:
        from fastembed import TextEmbedding
        got = len(next(iter(TextEmbedding(name).embed(["a terraced house on Moore Street"]))))
    except Exception as exc:
        errors[f"fastembed:{name}"] = short_err(exc)
        got = dim  # known dimension; the failure is reported below
    if got != dim:
        errors[f"fastembed:{name}"] = f"expected {dim} dims, got {got}"
    return f"fastembed:{name}", got, errors


def pick_roles(results, overrides):
    by_id = {r["id"]: r for r in results}
    roles = {}
    seeing = sorted((r for r in results if r["vision"] and r["json_schema"]),
                    key=lambda r: r.get("vision_ms", 1 << 30))
    vision = by_id.get(overrides["vision"]) if overrides["vision"] else (seeing[0] if seeing else None)
    verifier = by_id.get(overrides["verifier"]) if overrides["verifier"] else next(
        (r for r in seeing if vision and r["family"] != vision["family"]), None)
    full = sorted((r for r in results if r["tools_ok"] == r["trials"]),
                  key=lambda r: ("gpt-oss" not in r["id"].lower(), r.get("tools_ms") or 1 << 30))
    agent = by_id.get(overrides["agent"]) if overrides["agent"] else (full[0] if full else None)
    for role, r in (("VISION", vision), ("VERIFIER", verifier), ("AGENT", agent)):
        if r:
            roles.setdefault(r["id"], []).append(role)
    return vision, verifier, agent, roles


def print_table(results, roles):
    rows = [("model", "family", "vision", "json_schema", "tool calls", "chosen role")]
    for r in sorted(results, key=lambda r: (r["family"], r["id"])):
        rows.append((r["id"], r["family"], "yes" if r["vision"] else "no",
                     "yes" if r["json_schema"] else "no", f"{r['tools_ok']}/{r['trials']}",
                     "+".join(roles.get(r["id"], [])) or "-"))
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
    for n, row in enumerate(rows):
        print("  ".join(cell.ljust(w) for cell, w in zip(row, widths)).rstrip())
        if n == 0:
            print("  ".join("-" * w for w in widths))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trials", type=int, default=5)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--models", help="comma-separated ids to probe (default: all chat models)")
    ap.add_argument("--vision", help="force VISION_MODEL")
    ap.add_argument("--verifier", help="force VERIFIER_MODEL")
    ap.add_argument("--agent", help="force AGENT_MODEL")
    args = ap.parse_args()

    base_url, api_key = os.environ.get("TENSORX_BASE_URL"), os.environ.get("TENSORX_API_KEY")
    if not base_url or not api_key:
        print("Set TENSORX_BASE_URL and TENSORX_API_KEY (repo-root .env or environment).", file=sys.stderr)
        return 2
    client = OpenAI(base_url=base_url, api_key=api_key, max_retries=3)

    listed = [(m.id, getattr(m, "owned_by", None)) for m in client.models.list()]
    all_ids = [i for i, _ in listed]
    print(f"{len(listed)} models listed at {base_url}")
    chosen = set(args.models.split(",")) if args.models else None
    chat_models = [(i, o) for i, o in listed
                   if not NON_CHAT_RE.search(i) and (chosen is None or i in chosen)]
    chat_models.sort(key=lambda m: "gpt-oss" not in m[0].lower())  # gpt-oss is tested first
    print(f"probing {len(chat_models)} chat models, {args.trials} tool trials each ...", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda m: probe_model(client, m[0], m[1], args.trials), chat_models))

    vision, verifier, agent, roles = pick_roles(
        results, {"vision": args.vision, "verifier": args.verifier, "agent": args.agent})
    embed_model, embed_dim, embed_errors = probe_embeddings(client, all_ids, os.environ.get("EMBED_MODEL"))

    print()
    print_table(results, roles)

    print("\nfailures:")
    for r in results:
        for what, why in r["errors"].items():
            print(f"  {r['id']} [{what}] {why}")
    for model, why in embed_errors.items():
        print(f"  {model} [embeddings] {why}")

    print("\nwarnings:")
    if not vision:
        print("  no model passed vision + json_schema: VISION_MODEL is unset")
    if vision and not verifier:
        print(f"  no vision model from a family other than {vision['family']!r}: VERIFIER_MODEL is unset")
    if not agent:
        print("  no model made 5/5 valid tool calls: AGENT_MODEL is unset")
    if embed_model.startswith("fastembed:"):
        print("  no TensorX embedding model answered: using local fastembed")

    print("\n# .env lines for the team")
    print(f"VISION_MODEL={vision['id'] if vision else ''}")
    print(f"VERIFIER_MODEL={verifier['id'] if verifier else ''}")
    print(f"AGENT_MODEL={agent['id'] if agent else ''}")
    print(f"EMBED_MODEL={embed_model}")
    print(f"EMBED_DIM={embed_dim}")

    out = ROOT / "data" / "cache" / "probe_providers.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"results": results, "embed": {"model": embed_model, "dim": embed_dim,
                               "errors": embed_errors}}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
