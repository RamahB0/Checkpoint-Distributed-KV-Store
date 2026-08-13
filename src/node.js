// src/node.js
//
// A single storage node in the cluster. Each node owns its own slice of
// the keyspace (as decided by the consistent hash ring) plus a local
// LRU/TTL cache that sits in front of its storage map so repeated reads
// of hot keys don't need to hit the "disk" (here, just a JS object).

const { LRUCache } = require('./lruCache');

class StorageNode {
  constructor(id, { cacheCapacity = 3, cacheTtlMs = 5000 } = {}) {
    this.id = id;
    this.store = new Map(); // the durable per-node key-value data
    this.cache = new LRUCache({ capacity: cacheCapacity, ttlMs: cacheTtlMs });
    this.alive = true; // flips to false when we simulate a node failure
  }

  put(key, value) {
    this.store.set(key, value);
    this.cache.set(key, value); // warm the cache on write-through
  }

  get(key) {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return { value: cached, source: 'cache' };
    }
    if (this.store.has(key)) {
      const value = this.store.get(key);
      this.cache.set(key, value); // populate cache on a store hit
      return { value, source: 'store' };
    }
    return { value: undefined, source: 'miss' };
  }

  delete(key) {
    this.store.delete(key);
    this.cache.invalidate(key);
  }

  keys() {
    return Array.from(this.store.keys());
  }

  markDown() {
    this.alive = false;
  }

  markUp() {
    this.alive = true;
  }
}

module.exports = { StorageNode };
