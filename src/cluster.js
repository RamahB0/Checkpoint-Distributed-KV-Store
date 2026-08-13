// src/cluster.js
//
// The Cluster is the single entry point a "client" talks to. It hides
// every node-level detail behind put()/get()/delete() - that's the
// transparency requirement from the checkpoint: callers never need to
// know which physical node actually holds a key.
//
// Responsibilities:
//   - Use the consistent hash ring to decide which node(s) own a key.
//   - Replicate each write to `replicationFactor` nodes so that a single
//     node failure doesn't make the key unavailable (limited, not total,
//     availability loss).
//   - Route reads to the first *alive* replica, falling back through the
//     replica list if the primary is down.
//   - Support nodes joining/leaving the ring, migrating only the keys
//     that actually need to move.

const { ConsistentHashRing } = require('./consistentHash');
const { StorageNode } = require('./node');

class Cluster {
  constructor({ replicationFactor = 2, virtualNodesPerNode = 100 } = {}) {
    this.ring = new ConsistentHashRing(virtualNodesPerNode);
    this.nodes = new Map(); // nodeId -> StorageNode
    this.replicationFactor = replicationFactor;
  }

  // ---------------------------------------------------------------
  // Cluster membership (join / leave)
  // ---------------------------------------------------------------

  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return { moved: 0 };
    this.nodes.set(nodeId, new StorageNode(nodeId));
    this.ring.addNode(nodeId);
    return this._rebalanceAfterJoin(nodeId);
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return { moved: 0 };
    // Gather every key currently replicated on this node so we can
    // re-place it elsewhere before the node is actually dropped.
    const leavingNode = this.nodes.get(nodeId);
    const keysToReplace = leavingNode.keys();

    this.ring.removeNode(nodeId);
    this.nodes.delete(nodeId);

    let moved = 0;
    for (const key of keysToReplace) {
      const value = leavingNode.store.get(key);
      const newHomes = this.ring.getNodesForKey(key, this.replicationFactor);
      for (const homeId of newHomes) {
        const homeNode = this.nodes.get(homeId);
        if (homeNode && !homeNode.store.has(key)) {
          homeNode.put(key, value);
          moved++;
        }
      }
    }
    return { moved };
  }

  // When a node joins, only keys whose new primary/replica set now
  // includes the new node need to be copied onto it - everyone else's
  // data stays exactly where it was. This is what "minimal data
  // movement" means for consistent hashing versus plain mod-N hashing.
  _rebalanceAfterJoin(newNodeId) {
    let moved = 0;
    for (const [otherId, otherNode] of this.nodes) {
      if (otherId === newNodeId) continue;
      for (const key of otherNode.keys()) {
        const homes = this.ring.getNodesForKey(key, this.replicationFactor);
        if (homes.includes(newNodeId)) {
          const value = otherNode.store.get(key);
          this.nodes.get(newNodeId).put(key, value);
          moved++;
        }
      }
    }
    return { moved };
  }

  // ---------------------------------------------------------------
  // Failure simulation
  // ---------------------------------------------------------------

  simulateFailure(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) node.markDown();
  }

  recoverNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) node.markUp();
  }

  // ---------------------------------------------------------------
  // Client-facing, node-agnostic API (transparency)
  // ---------------------------------------------------------------

  put(key, value) {
    const homes = this.ring.getNodesForKey(key, this.replicationFactor);
    if (homes.length === 0) {
      throw new Error('No nodes available in the cluster');
    }
    let writes = 0;
    for (const nodeId of homes) {
      const node = this.nodes.get(nodeId);
      if (node && node.alive) {
        node.put(key, value);
        writes++;
      }
    }
    return { replicas: homes, writes };
  }

  get(key) {
    const homes = this.ring.getNodesForKey(key, this.replicationFactor);
    for (const nodeId of homes) {
      const node = this.nodes.get(nodeId);
      if (node && node.alive) {
        const { value, source } = node.get(key);
        if (value !== undefined) {
          return { value, servedBy: nodeId, source, replicas: homes };
        }
      }
    }
    // Every replica holding this key is down (or the key doesn't exist)-
    // this is the "limited availability" case: the rest of the cluster
    // keeps working, only this key is temporarily unreachable.
    return { value: undefined, servedBy: null, source: 'unavailable', replicas: homes };
  }

  delete(key) {
    const homes = this.ring.getNodesForKey(key, this.replicationFactor);
    for (const nodeId of homes) {
      const node = this.nodes.get(nodeId);
      if (node) node.delete(key);
    }
  }

  // ---------------------------------------------------------------
  // Introspection helpers used by the demo / for debugging
  // ---------------------------------------------------------------

  describe() {
    const layout = {};
    for (const [nodeId, node] of this.nodes) {
      layout[nodeId] = {
        alive: node.alive,
        keys: node.keys(),
        cache: node.cache.stats(),
      };
    }
    return layout;
  }
}

module.exports = { Cluster };
