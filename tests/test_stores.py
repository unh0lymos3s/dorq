from core.stores import LRUStore


async def test_items_most_recent_first():
    store: LRUStore[int] = LRUStore(maxsize=3)
    await store.put("a", 1)
    await store.put("b", 2)
    await store.put("c", 3)
    assert await store.items() == [("c", 3), ("b", 2), ("a", 1)]

    # A read refreshes recency.
    await store.get("a")
    assert await store.items() == [("a", 1), ("c", 3), ("b", 2)]


async def test_eviction_beyond_maxsize():
    store: LRUStore[int] = LRUStore(maxsize=2)
    await store.put("a", 1)
    await store.put("b", 2)
    await store.put("c", 3)
    assert await store.get("a") is None
    assert [k for k, _ in await store.items()] == ["c", "b"]
