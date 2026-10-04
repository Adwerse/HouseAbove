"""Badge engine (CONTRACT: "Badge engine interface"). B implements, C's routes call.

Stubs only: they return [] / {} until B fills them in.
"""


def evaluate_walker(db, walker_id: str) -> list[dict]:
    """Idempotent; returns only the new awards."""
    return []


def on_inspection(db, building_id: str, outcome: str) -> list[dict]:
    """homes_above for confirmed_candidate, lights_on for returned_to_use, to captured_by."""
    return []


def stats(db, walker_id: str) -> dict:
    return {}
