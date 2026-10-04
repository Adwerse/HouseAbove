"""Pure rules shared by the pipeline, the API and MCP. No I/O."""
import re

from app.schemas import FacadeReading

# --- status -----------------------------------------------------------------

STATUS_ORDER = {"likely_underused": 0, "unclear": 1, "likely_used": 2}


def display_status(b: dict) -> str:
    """CONTRACT "Display status": derive it exactly this way everywhere."""
    outcome = (b.get("inspection") or {}).get("outcome")
    if outcome == "returned_to_use":
        return "home"
    if outcome == "confirmed_candidate":
        return "confirmed"
    if outcome == "not_suitable":
        return "likely_used"
    if b.get("needs_human") and not b.get("human_label"):
        return "review"
    return b.get("human_label") or b.get("upper_status") or "unclear"


# --- pass 1 and pass 2 ------------------------------------------------------

def _scrub(text: str) -> str:
    """Product rule: never say "vacant" in free text."""
    return re.sub(r"\bvacant\b", "unused", text, flags=re.I)


def clean_phrases(items: list[str]) -> list[str]:
    return [_scrub(s.strip())[:120] for s in items if s.strip()][:8]


def clean_reading(r: FacadeReading) -> FacadeReading:
    """Rules the prompt asks for but code enforces: likely_underused needs at
    least one visible signal, otherwise unclear."""
    signals = clean_phrases(r.upper_signals)
    status = r.upper_status
    if status == "likely_underused" and not signals:
        status = "unclear"
    return r.model_copy(update={"upper_signals": signals, "upper_status": status,
                                "evidence": _scrub(r.evidence.strip())})


def review_fields(upper_status: str, confidence: float, verifier_status: str) -> dict:
    """needs_human is an escalation trigger, not proof of accuracy: two passes
    agreeing is not ground truth."""
    agree = verifier_status == upper_status
    return {"agree": agree, "needs_human": (not agree) or confidence < 0.6}


def height_m(upper_floors: int | None) -> float:
    return round((upper_floors + 1) * 3.2, 1) if upper_floors is not None else 9.6


# --- services and rank ------------------------------------------------------

SERVICE_KINDS = ("bus", "grocery", "school", "gp_or_pharmacy", "park")
# Brief, infra.py: one point each when the nearest one is within this many metres.
SERVICE_THRESHOLD_M = {"bus": 400, "grocery": 400, "school": 800, "gp_or_pharmacy": 800, "park": 800}


def services_score(dist_m: dict) -> int:
    """dist_m: {"bus": 120, "grocery": None, ...} nearest distance per kind."""
    return sum(1 for k, limit in SERVICE_THRESHOLD_M.items()
               if dist_m.get(k) is not None and dist_m[k] <= limit)


def ranking_status(b: dict) -> str:
    outcome = (b.get("inspection") or {}).get("outcome")
    if outcome in ("not_suitable", "returned_to_use"):
        return "likely_used"
    if outcome == "confirmed_candidate":
        return "likely_underused"
    return b.get("human_label") or b.get("upper_status") or "unclear"


def rank_key(b: dict) -> tuple:
    """Brief, infra.py: likely_underused, then unclear, then likely_used; separate
    entrance yes first; higher services score first; higher confidence first."""
    return (STATUS_ORDER.get(ranking_status(b), 1),
            0 if b.get("separate_entrance") == "yes" else 1,
            -((b.get("services") or {}).get("score") or 0),
            -(b.get("confidence") or 0.0),
            str(b.get("_id", "")))


# --- ids, streets, labels ---------------------------------------------------

_ID_RE = re.compile(r"^(?P<name>[A-Za-z][A-Za-z_]*?)_(?P<num>\d+[A-Za-z]?)(?:_.*)?$")
_ABBREVIATIONS = {"Street": "St", "Road": "Rd", "Avenue": "Ave"}


def parse_id(photo_id: str) -> tuple[str | None, str | None]:
    """"north_earl_7" -> ("North Earl", "7")."""
    m = _ID_RE.match(photo_id)
    if not m:
        return None, None
    return m["name"].replace("_", " ").title(), m["num"]


def derive_street(photo_id: str) -> str | None:
    name, _ = parse_id(photo_id)
    return f"{name} Street" if name else None


def make_label(photo_id: str, street: str | None, note: str | None) -> str:
    """"Talbot St 12" from street + the number in the id, else a short note, else the id."""
    _, num = parse_id(photo_id)
    if street and num:
        short = " ".join(_ABBREVIATIONS.get(w, w) for w in street.split())
        return f"{short} {num}"
    if note and len(note) <= 30 and "," not in note:
        return note
    return photo_id


def street_key(s: str | None) -> str:
    """Compare street names loosely: "talbot-street" == "Talbot St"."""
    s = re.sub(r"[\s_-]+", " ", (s or "")).strip().lower()
    return re.sub(r"\bst\b", "street", s)
