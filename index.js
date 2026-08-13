// index.js
//
// Demo / verification script for the distributed key-value store
// checkpoint. It exercises every instruction from the checkpoint brief
// against the sample dataset (user:101 .. user:106) and prints what
// happens at each step so the behaviour can be inspected without a
// real multi-machine cluster.
//
//   1. Consistent hashing dynamically assigns keys to nodes.
//   2. Node join/leave triggers only minimal data movement.
//   3. An LRU/TTL cache sits in front of each node's storage.
//   4. Simulated node failures still let the rest of the system respond
//      (limited, not total, availability loss) thanks to replication.
//   5. The Cluster API hides all node-level detail from the caller
//      (transparency) - callers only ever call cluster.get/put.

const { Cluster } = require('./src/cluster');

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

const sampleUsers = {
  'user:101': { name: 'Alice' },
  'user:102': { name: 'Bob' },
  'user:103': { name: 'Charlie' },
  'user:104': { name: 'Diana' },
  'user:105': { name: 'Eve' },
  'user:106': { name: 'Frank' },
};

// --- 1. Bring up a 3-node cluster and load the sample data -------------
section('Cluster startup: adding nodeA, nodeB, nodeC');
const cluster = new Cluster({ replicationFactor: 2, virtualNodesPerNode: 100 });
for (const nodeId of ['nodeA', 'nodeB', 'nodeC']) {
  const { moved } = cluster.addNode(nodeId);
  console.log(`Added ${nodeId} (migrated ${moved} existing keys onto it)`);
}

section('Consistent hashing: placing the sample users');
for (const [key, value] of Object.entries(sampleUsers)) {
  const { replicas, writes } = cluster.put(key, value);
  console.log(`${key} -> primary=${replicas[0]}, replicas=[${replicas.join(', ')}] (wrote to ${writes} node(s))`);
}

section('Cluster layout after initial writes (client never sees this - it is for inspection only)');
console.log(JSON.stringify(cluster.describe(), null, 2));

// --- 2. Reads: transparency + cache behaviour ---------------------------
section('Reads via the transparent client API (cluster.get) - cold cache');
for (const key of Object.keys(sampleUsers)) {
  const result = cluster.get(key);
  console.log(`${key} -> ${JSON.stringify(result.value)} (served by ${result.servedBy}, source=${result.source})`);
}

section('Re-reading the same keys - should now be served from cache');
for (const key of Object.keys(sampleUsers)) {
  const result = cluster.get(key);
  console.log(`${key} -> ${JSON.stringify(result.value)} (served by ${result.servedBy}, source=${result.source})`);
}

// --- 3. Node join: minimal data movement --------------------------------
section('Node join: adding nodeD to the ring');
const joinResult = cluster.addNode('nodeD');
console.log(`nodeD joined - ${joinResult.moved} key-copies migrated onto it (out of ${Object.keys(sampleUsers).length} keys x 2 replicas = ${Object.keys(sampleUsers).length * 2} total copies)`);
console.log('Cluster layout after join:');
console.log(JSON.stringify(cluster.describe(), null, 2));

// --- 4. Simulate a node failure: limited availability -------------------
section('Simulating a failure of nodeA');
cluster.simulateFailure('nodeA');
console.log('nodeA is now marked as down. Reading all keys again:');
for (const key of Object.keys(sampleUsers)) {
  const result = cluster.get(key);
  const status = result.value !== undefined ? 'OK' : 'UNAVAILABLE';
  console.log(`${key} -> [${status}] ${JSON.stringify(result.value)} (served by ${result.servedBy}, replicas=[${result.replicas.join(', ')}])`);
}
console.log('\nNotice: every key is still served (replication meant a live replica always exists),');
console.log('demonstrating limited-availability degradation rather than a full outage.');

// --- 5. Recover the node ------------------------------------------------
section('Recovering nodeA');
cluster.recoverNode('nodeA');
console.log('nodeA is back up.');

// --- 6. Node leave: rebalancing -----------------------------------------
section('Node leave: removing nodeB from the cluster');
const leaveResult = cluster.removeNode('nodeB');
console.log(`nodeB left - ${leaveResult.moved} key-copies re-homed onto its surviving replicas`);
console.log('Cluster layout after leave:');
console.log(JSON.stringify(cluster.describe(), null, 2));

section('Final sanity check: every key is still reachable after the leave');
for (const key of Object.keys(sampleUsers)) {
  const result = cluster.get(key);
  console.log(`${key} -> ${JSON.stringify(result.value)} (served by ${result.servedBy})`);
}

section('Cache stats per surviving node');
for (const [nodeId, info] of Object.entries(cluster.describe())) {
  console.log(`${nodeId}: ${JSON.stringify(info.cache)}`);
}
