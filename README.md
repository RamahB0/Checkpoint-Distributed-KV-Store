# Checkpoint: Distributed Key-Value Store with Consistent Hashing and Caching

A simulated distributed key-value storage system built in plain Node.js
(no external dependencies) that demonstrates the core design principles
of distributed systems: **scalability** (consistent hashing spreads keys
across nodes and rebalances with minimal data movement), **availability**
(replication keeps keys reachable even when a node fails), and
**transparency** (clients only ever talk to the `Cluster` API - they
never know which physical node actually stores a key).

## What's here

- `src/consistentHash.js` - a consistent-hashing ring. Each physical
  node is placed at many "virtual node" positions on the ring (via an
  md5-based hash), which keeps keys evenly distributed and means only a
  small slice of the keyspace moves when a node joins or leaves - unlike
  naive `hash(key) % N` partitioning, where almost every key would move.
- `src/lruCache.js` - a small in-memory cache combining an LRU
  (Least Recently Used) eviction policy with a TTL (Time-To-Live)
  expiry, as suggested by the checkpoint brief.
- `src/node.js` - a `StorageNode`: an in-memory key-value map with an
  `LRUCache` sitting in front of it (write-through on `put`, populate-on-
  read for cache misses), plus an `alive` flag used to simulate failures.
- `src/cluster.js` - the `Cluster`: the single entry point a caller
  interacts with.
  - `put`/`get`/`delete` hide all node-level detail (**transparency**).
  - Every write is replicated to `replicationFactor` nodes (default 2)
    chosen by walking the hash ring, so a single node going down still
    leaves a live replica to answer reads (**limited availability loss**,
    not a full outage).
  - `addNode`/`removeNode` implement join/leave: on join, only the keys
    whose replica set now includes the new node are copied onto it; on
    leave, only the leaving node's keys are re-homed onto their
    remaining/new replicas (**minimal data movement**).
  - `simulateFailure`/`recoverNode` flip a node's `alive` flag so reads
    transparently fall back to another replica while it's "down".
- `index.js` - a demo/verification script that exercises every
  instruction from the checkpoint brief against the sample dataset
  (`user:101` .. `user:106`) and prints the result of each step.
- `output.txt` - captured output of `node index.js`, showing: initial
  key placement, cache-warmed reads, a node join with the resulting
  migration count, a simulated node failure (and that every key is still
  served), node recovery, a node leaving with rebalancing, a final
  reachability check, and per-node cache stats.
- `package.json` - project manifest (`npm start` / `npm run demo`).

## How each instruction is satisfied

1. **Use consistent hashing to assign keys to nodes dynamically.**
   `ConsistentHashRing` (`src/consistentHash.js`) hashes both nodes and
   keys onto the same ring; `Cluster.put/get` always look the key's
   owner(s) up dynamically via `ring.getNodesForKey(...)`.
2. **Implement node join/leave and observe minimal data movement.**
   `Cluster.addNode` / `Cluster.removeNode` only copy the keys whose
   replica set actually changed; `index.js` logs the exact number of
   key-copies moved on join and on leave.
3. **Add a simple caching layer (LRU or TTL).**
   `LRUCache` combines both: capacity-based LRU eviction plus a TTL
   expiry per entry, embedded in every `StorageNode`.
4. **Simulate node failures and show limited availability.**
   `Cluster.simulateFailure('nodeA')` marks a node down; `Cluster.get`
   automatically serves from the next live replica, so every key in the
   demo stays reachable - the failure degrades the cluster rather than
   taking it fully offline.
5. **Hide node-level complexity from users (transparency).**
   Callers only ever use `cluster.put(key, value)` / `cluster.get(key)`;
   `index.js` never manually picks a node - the cluster does that
   internally via the hash ring and returns which node happened to serve
   the request purely for demo/debugging purposes.

## Running it

```bash
npm start        # runs index.js and prints the full demo to stdout
npm run demo      # same thing, redirected into output.txt
```

No external services or dependencies are required - everything runs
in-process using plain JavaScript `Map`s to stand in for each node's
storage.
