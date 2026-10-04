#!/usr/bin/env bash
# Real photos end to end: drop the original JPG/HEIC files into data/photos/ (keep the
# file names, labels.csv refers to them), then run from the repo root:
#   bash pipeline/real_photos.sh
# Reads the photos with both AI passes, adds services, exports, and syncs into web/public
# so the front end (static mode or not) shows the real photos instead of illustrations.
set -u
cd "$(dirname "$0")/.."
PY=${PY:-python}
export VISION_MODEL=${VISION_MODEL:-deepseek/deepseek-v4.1-flash}
export VERIFIER_MODEL=${VERIFIER_MODEL:-z-ai/glm-5.3-flash}
export AGENT_MODEL=${AGENT_MODEL:-qwen/qwen3.8-2.4t-a95b}
export EMBED_MODEL=${EMBED_MODEL:-qwen/qwen3-embedding-8b}
export EMBED_DIM=${EMBED_DIM:-4096}
n=$(ls data/photos 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -gt 0 ] || { echo "data/photos is empty: copy the original photos there first"; exit 2; }
echo "== $n photos"
$PY pipeline/survey_vision.py || exit 1
$PY pipeline/verify.py || echo "verify had failures, continuing"
$PY pipeline/geo.py || echo "geo skipped (Overpass busy?), buildings show as prisms"
$PY pipeline/services.py --refresh || echo "services skipped (Overpass busy?)"
$PY pipeline/eval.py || echo "eval skipped"
$PY pipeline/export.py || exit 1
(cd web && npm run sync-data)
echo "== done: reload the page"
