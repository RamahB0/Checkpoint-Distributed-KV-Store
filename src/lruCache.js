// src/lruCache.js
//
// A small in-memory cache combining two eviction policies, as suggested
// by the checkpoint instructions ("LRU or TTL"): here we use both.
//   - LRU (Least Recently Used): once the cache is full, the entry that
//     hasn't been touched in the longest time is evicted first.
//   - TTL (Time-To-Live): entries older than `ttlMs` are treated as
//     expired and are not served from the cache, even if there's room.
//
// Backed by a Map, which preserves insertion order in JS - re-inserting
// a key on every access is what gives us "most recently used" ordering
// for free.

class LRUCache {
  constructor({ capacity = 3, ttlMs = 5000 } = {}) {
    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.store = new Map(); // key -> { value, expiresAt }
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    if (!this.store.has(key)) {
      this.misses++;
      return undefined;
    }
    const entry = this.store.get(key);
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key); // expired - treat as a miss
      this.misses++;
      return undefined;
    }
    // Refresh recency: delete + re-set moves it to the "end" of the Map.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict the least-recently-used entry (first key in the Map).
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key) {
    this.store.delete(key);
  }

  stats() {
    return { size: this.store.size, hits: this.hits, misses: this.misses };
  }
}

module.exports = { LRUCache };
