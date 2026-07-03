"""Bounded in-memory stores for papers and backtest results."""

import asyncio
from collections import OrderedDict
from typing import Generic, TypeVar

V = TypeVar("V")


class LRUStore(Generic[V]):
    """Thread-safe async LRU store backed by an OrderedDict."""

    def __init__(self, maxsize: int = 128) -> None:
        self._d: OrderedDict[str, V] = OrderedDict()
        self._max = maxsize
        self._lock = asyncio.Lock()

    async def put(self, key: str, value: V) -> None:
        async with self._lock:
            self._d[key] = value
            self._d.move_to_end(key)
            while len(self._d) > self._max:
                self._d.popitem(last=False)

    async def get(self, key: str) -> V | None:
        async with self._lock:
            if key not in self._d:
                return None
            self._d.move_to_end(key)
            return self._d[key]

    async def items(self) -> list[tuple[str, V]]:
        """Snapshot of (key, value) pairs, most recently used first."""
        async with self._lock:
            return list(reversed(self._d.items()))

    def get_sync(self, key: str) -> V | None:
        """Non-async read for use inside sync contexts."""
        return self._d.get(key)
