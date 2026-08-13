// src/consistentHash.js
//
// A consistent-hashing ring used to dynamically assign keys to nodes.
//
// Each physical node is represented by many "virtual nodes" (replicas)
// spread around the ring. This keeps the distribution of keys roughly
// even across physical nodes and-critically-means that when a node
// joins or leaves, only the keys that fall between its virtual nodes'
// neighbours on the ring need to move, instead of a full reshuffle.

const crypto = require('crypto');

function hashToInt(key) {
  // 32-bit unsigned integer derived from an md5 digest. Using md5 here
  // purely as a fast, well-distributed hash function - not for security.
  const hash = crypto.createHash('md5').update(String(key)).digest('hex');
  return parseInt(hash.slice(0, 8), 16);
}

class ConsistentHashRing {
  /**
   * @param {number} virtualNodesPerNode - number of points each physical
   *   node occupies on the ring. Higher = more even key distribution.
   */
  constructor(virtualNodesPerNode = 100) {
    this.virtualNodesPerNode = virtualNodesPerNode;
    // Sorted array of [ringPosition, physicalNodeId] pairs.
    this.ring = [];
    this.nodes = new Set();
  }

  _insertSorted(position, nodeId) {
    // Binary-search insertion so the ring array stays sorted by position.
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid][0] < position) lo = mid + 1;
      else hi = mid;
    }
    this.ring.splice(lo, 0, [position, nodeId]);
  }

  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return;
    this.nodes.add(nodeId);
    for (let v = 0; v < this.virtualNodesPerNode; v++) {
      const position = hashToInt(`${nodeId}#vnode${v}`);
      this._insertSorted(position, nodeId);
    }
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return;
    this.nodes.delete(nodeId);
    this.ring = this.ring.filter(([, id]) => id !== nodeId);
  }

  /**
   * Walk clockwise from the key's hash position and return the first
   * `count` *distinct* physical nodes encountered. The first entry is
   * the primary owner of the key; the rest are replica holders.
   */
  getNodesForKey(key, count = 1) {
    if (this.ring.length === 0) return [];
    const position = hashToInt(key);

    // Binary search for the first ring entry >= position (wrap around).
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid][0] < position) lo = mid + 1;
      else hi = mid;
    }
    let startIndex = lo === this.ring.length ? 0 : lo;

    const result = [];
    const seen = new Set();
    let i = startIndex;
    while (result.length < count && seen.size < this.nodes.size) {
      const [, nodeId] = this.ring[i];
      if (!seen.has(nodeId)) {
        seen.add(nodeId);
        result.push(nodeId);
      }
      i = (i + 1) % this.ring.length;
    }
    return result;
  }
}

module.exports = { ConsistentHashRing, hashToInt };
