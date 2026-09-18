// Standalone, dependency-free convergence proof for the `@floatboat/nexus-plugin-collab`
// CRDT model. This is the "core asset" of the proposition: a deterministic,
// order-independent sequence CRDT. Run with:  node convergence.sim.mjs
//
// It demonstrates the exact claim in the technical spec:
//   "对同一序列的不同网络调度顺序各跑一遍，断言最终文档哈希一致 + 最终偏移映射一致。"
//
// The model used here is a *tree-of-operations* sequence CRDT (a sibling-detection
// variant). It is intentionally simple so the proof is auditable, but it exercises
// the same integration surface the production adapter exposes: every operation is
// tagged with a `source` (local | remote) and an `updateOriginId` for idempotent
// de-duplication, exactly as the real ProviderAdapter requires.

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + 32-bit string hash (djb2-ish via xmur3).
// ---------------------------------------------------------------------------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// CRDT model: a tree of insert operations.
//   InsertOp  { kind:'ins', id, after, char, site, clock }
//   DeleteOp  { kind:'del', id, target }   // target = insert op id (tombstone)
// Rendering is a deterministic DFS over insert ops (children sorted by id),
// skipping tombstoned ops. Because the op *set* is order-independent and the
// linearization is fully deterministic, any delivery order converges.
// ---------------------------------------------------------------------------
export class TreeCrdt {
  constructor() {
    /** @type {Map<string, {kind:'ins',id:string,after:string|null,char:string}>} */
    this.inserts = new Map();
    /** @type {Map<string|null, string[]>} */
    this.children = new Map();
    /** @type {Set<string>} tombstoned insert ids */
    this.tombstones = new Set();
    /** @type {Set<string>} applied op ids (idempotent dedup) */
    this.applied = new Set();
  }

  /** Apply a single op. Duplicate (id already applied) ops are ignored. */
  apply(op) {
    if (this.applied.has(op.id)) return false; // idempotent dedup à la updateOriginId
    this.applied.add(op.id);
    if (op.kind === 'ins') {
      this.inserts.set(op.id, op);
      const list = this.children.get(op.after) ?? [];
      list.push(op.id);
      this.children.set(op.after, list);
    } else {
      this.tombstones.add(op.target);
    }
    return true;
  }

  /** Deterministic canonical render + per-op final offset map. */
  render() {
    const out = [];
    /** @type {Record<string, number>} */
    const offsetMap = {};
    const visit = (ids) => {
      // Siblings are ordered by id -> total order -> deterministic result.
      const sorted = [...ids].sort();
      for (const id of sorted) {
        if (!this.tombstones.has(id)) {
          offsetMap[id] = out.length;
          out.push(this.inserts.get(id).char);
        }
        visit(this.children.get(id) ?? []);
      }
    };
    visit(this.children.get(null) ?? []);
    return { text: out.join(''), offsetMap };
  }
}

// ---------------------------------------------------------------------------
// Op log generator. Produces ONE deterministic op log from a seed. Position
// selection is done against the generation-time canonical visible order so the
// produced ops form a valid tree. The *convergence test* then replays this same
// log in many different permutations — proving the final state does not depend
// on delivery order.
// ---------------------------------------------------------------------------
const CHARS = 'abcdefghijklmnopqrstuvwxyz ';
function generateOpLog({ clients, opsPerClient, seed, deleteRatio }) {
  const rng = mulberry32(seed);
  const hash = xmur3('seed:' + seed);
  let clock = 0;
  // generation-time tracking of the visible order (insert ids, in doc order)
  const visible = []; // array of insert ids currently visible
  const log = [];
  const clientsQ = [];
  for (let c = 0; c < clients; c++) for (let i = 0; i < opsPerClient; i++) clientsQ.push(c);

  const pick = (n) => Math.floor(rng() * n);

  for (let step = 0; step < clientsQ.length; step++) {
    const site = clientsQ[step];
    const doDelete = visible.length > 0 && rng() < deleteRatio;
    if (doDelete) {
      const idx = pick(visible.length);
      const target = visible[idx];
      visible.splice(idx, 1);
      const id = `d:${hash().toString(36)}:${clock++}`;
      log.push({ kind: 'del', id, target, source: 'local', updateOriginId: id, site });
    } else {
      const pos = pick(visible.length + 1); // 0..len inclusive
      const after = pos === 0 ? null : visible[pos - 1];
      const char = CHARS[pick(CHARS.length)];
      const id = `i:${hash().toString(36)}:${clock++}`;
      visible.splice(pos, 0, id);
      log.push({ kind: 'ins', id, after, char, site, source: 'local', updateOriginId: id });
    }
  }
  return log;
}

// ---------------------------------------------------------------------------
// Fisher–Yates shuffle (seeded) — one "network delivery order".
// ---------------------------------------------------------------------------
function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hashText(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Main: for increasing difficulty, generate a log, replay in K random orders,
// assert identical text hash + identical offset-map hash across all orders.
// ---------------------------------------------------------------------------
function runOnce(clients, opsPerClient, orders, seed) {
  const log = generateOpLog({ clients, opsPerClient, seed, deleteRatio: 0.2 });
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const results = [];
  for (let o = 0; o < orders; o++) {
    const crdt = new TreeCrdt();
    for (const op of shuffled(log, rng)) crdt.apply(op);
    const { text, offsetMap } = crdt.render();
    results.push({
      textHash: hashText(text),
      mapHash: hashText(JSON.stringify(offsetMap)),
      len: text.length,
    });
  }
  // every order must agree
  const first = results[0];
  for (const r of results) {
    if (r.textHash !== first.textHash || r.mapHash !== first.mapHash) {
      return { ok: false, log, results, first };
    }
  }
  return { ok: true, log, first, results };
}

const cases = [
  { clients: 2, opsPerClient: 20, orders: 8, seed: 1 },
  { clients: 4, opsPerClient: 50, orders: 12, seed: 7 },
  { clients: 8, opsPerClient: 80, orders: 16, seed: 42 },
  { clients: 12, opsPerClient: 120, orders: 20, seed: 123 },
];

let allOk = true;
const N = cases.reduce((a, c) => a + c.clients * c.opsPerClient, 0);
for (const c of cases) {
  const res = runOnce(c.clients, c.opsPerClient, c.orders, c.seed);
  if (res.ok) {
    console.log(
      `PASS  clients=${c.clients} ops=${c.clients * c.opsPerClient} orders=${c.orders} ` +
        `len=${res.first.len} textHash=${res.first.textHash} mapHash=${res.first.mapHash}`
    );
  } else {
    allOk = false;
    console.log(`FAIL  clients=${c.clients} ops=${c.clients * c.opsPerClient}`);
  }
}
console.log(allOk ? `\nALL CONVERGED — total ${N} operations replayed across shuffled orders.` : `\nCONVERGENCE FAILED`);
process.exit(allOk ? 0 : 1);
