"""In-process pub/sub.

publish(type, payload) can be called from any thread (agent runs, pipeline
code, request handlers). subscribe() must be called from a running event loop
and returns an async iterator of events: {"type", "payload", "ts"}.
"""
import asyncio
import threading
import time
from typing import Any

_lock = threading.Lock()
_subscribers: set["Subscription"] = set()


class Subscription:
    def __init__(self, maxsize: int = 1000):
        self._loop = asyncio.get_running_loop()
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=maxsize)
        with _lock:
            _subscribers.add(self)

    def _put(self, event: dict) -> None:
        if self._queue.full():
            self._queue.get_nowait()  # slow consumer: drop the oldest
        self._queue.put_nowait(event)

    def close(self) -> None:
        with _lock:
            _subscribers.discard(self)

    def __aiter__(self) -> "Subscription":
        return self

    async def __anext__(self) -> dict:
        return await self._queue.get()

    def __enter__(self) -> "Subscription":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def subscribe() -> Subscription:
    return Subscription()


def publish(type: str, payload: dict | None = None) -> dict:
    event = {"type": type, "payload": payload or {}, "ts": time.time()}
    with _lock:
        subs = list(_subscribers)
    for sub in subs:
        try:
            sub._loop.call_soon_threadsafe(sub._put, event)
        except RuntimeError:  # that loop is closed
            sub.close()
    return event
