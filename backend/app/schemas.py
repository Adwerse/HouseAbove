"""Pydantic models for what the two AI passes must return.

Range checks live in validators, not in Field(ge=, le=), so the JSON schema sent
to the model stays within what strict structured output accepts.
"""
from typing import Literal

from pydantic import BaseModel, field_validator

UpperStatus = Literal["likely_underused", "likely_used", "unclear"]


class FacadeReading(BaseModel):
    """Pass 1: one facade photo."""

    ground_floor: Literal["open", "vacant", "unclear"]
    upper_floors: int | None
    upper_status: UpperStatus
    upper_signals: list[str]
    separate_entrance: Literal["yes", "no", "unclear"]
    confidence: float
    evidence: str

    @field_validator("confidence")
    @classmethod
    def _confidence_range(cls, v: float) -> float:
        if not 0 <= v <= 1:
            raise ValueError("confidence must be between 0 and 1")
        return v

    @field_validator("upper_floors")
    @classmethod
    def _floors_range(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 12:
            raise ValueError("upper_floors must be between 0 and 12, or null if you cannot tell")
        return v


class UpperFloorsCheck(BaseModel):
    """Pass 2: the top of the same photo, a different question."""

    for_use: list[str]
    against_use: list[str]
    status: UpperStatus


class StaffReading(BaseModel):
    """What a shop worker's free-text answer says about the floors above."""

    reading: Literal["lives_upstairs", "empty_upstairs", "unsure"]
