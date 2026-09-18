/**
 * Reference CRDT model for `@floatboat/nexus-plugin-collab`.
 *
 * This is a *tree-of-operations* sequence CRDT — deliberately simple so the
 * convergence proof is auditable, but it exercises exactly the integration
 * surface the production {@link CollabProviderAdapter} exposes:
 *
 *  - every operation carries `source: 'local' | 'remote'` and an
 *    `updateOriginId` used for idempotent de-duplication (mirrors Yjs
 *    `origin` + `updateOriginId`);
 *  - rendering is a deterministic DFS over insert operations ordered by id,
 *    skipping tombstones — therefore the final state depends only on the
 *    *set* of applied operations, never on delivery order.
 *
 * The production adapter (`YjsCollabProvider`) swaps in a battle-tested
 * engine behind the same abstraction. The tests run against this reference
 * implementation so they remain dependency-free and fast.
 */

export type OpSource = "local" | "remote";

export interface UpdateMeta {
  /** Where this update originated. Drives the loop-prevention filter. */
  readonly source: OpSource;
  /** Stable id used to de-duplicate an update that arrives twice. */
  readonly updateOriginId: string;
}

export interface InsertOp {
  readonly kind: "ins";
  readonly id: string;
  /** Parent insert-op id, or null for the document start. */
  readonly after: string | null;
  readonly char: string;
  readonly site: number;
  readonly source: OpSource;
  readonly updateOriginId: string;
}

export interface DeleteOp {
  readonly kind: "del";
  readonly id: string;
  /** Insert-op id being tombstoned. */
  readonly target: string;
  readonly source: OpSource;
  readonly updateOriginId: string;
}

export type CollabOp = InsertOp | DeleteOp;

export interface RenderResult {
  readonly text: string;
  /** insert-op id -> final document offset. */
  readonly offsetMap: Record<string, number>;
}

export class TreeCrdt {
  private readonly inserts = new Map<string, InsertOp>();
  private readonly children = new Map<string | null, string[]>();
  private readonly tombstones = new Set<string>();
  private readonly applied = new Set<string>();

  /** Apply one op. Duplicate (already-applied id) ops are ignored. */
  apply(op: CollabOp): boolean {
    if (this.applied.has(op.id)) return false; // idempotent dedup
    this.applied.add(op.id);
    if (op.kind === "ins") {
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
  render(): RenderResult {
    const out: string[] = [];
    const offsetMap: Record<string, number> = {};
    const visit = (ids: string[]): void => {
      const sorted = [...ids].sort();
      for (const id of sorted) {
        if (!this.tombstones.has(id)) {
          offsetMap[id] = out.length;
          out.push(this.inserts.get(id)!.char);
        }
        visit(this.children.get(id) ?? []);
      }
    };
    visit(this.children.get(null) ?? []);
    return { text: out.join(""), offsetMap };
  }
}

// ---------------------------------------------------------------------------
// Deterministic PRNG + hash (kept identical to the standalone sim so the
// property test and `convergence.sim.mjs` agree).
// ---------------------------------------------------------------------------
function xmur3(str: string): () => number {
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

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashText(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const CHARS = "abcdefghijklmnopqrstuvwxyz ";

/** Generate one deterministic op log from a seed (insert/delete mix). */
export function generateOpLog(opts: {
  clients: number;
  opsPerClient: number;
  seed: number;
  deleteRatio?: number;
}): CollabOp[] {
  const { clients, opsPerClient, seed } = opts;
  const deleteRatio = opts.deleteRatio ?? 0.2;
  const rng = mulberry32(seed);
  const hash = xmur3("seed:" + seed);
  let clock = 0;
  const visible: string[] = [];
  const log: CollabOp[] = [];
  const queue: number[] = [];
  for (let c = 0; c < clients; c++) for (let i = 0; i < opsPerClient; i++) queue.push(c);
  const pick = (n: number) => Math.floor(rng() * n);

  for (const site of queue) {
    const doDelete = visible.length > 0 && rng() < deleteRatio;
    if (doDelete) {
      const idx = pick(visible.length);
      const target = visible[idx];
      visible.splice(idx, 1);
      const id = `d:${hash().toString(36)}:${clock++}`;
      log.push({ kind: "del", id, target, source: "local", updateOriginId: id });
    } else {
      const pos = pick(visible.length + 1);
      const after = pos === 0 ? null : visible[pos - 1];
      const char = CHARS[pick(CHARS.length)];
      const id = `i:${hash().toString(36)}:${clock++}`;
      visible.splice(pos, 0, id);
      log.push({ kind: "ins", id, after, char, site, source: "local", updateOriginId: id });
    }
  }
  return log;
}

export function shuffled<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Apply a log (in the given order) to a fresh replica. */
export function applyLogInOrder(log: readonly CollabOp[], order?: number[]): TreeCrdt {
  const crdt = new TreeCrdt();
  const seq = order ? order.map((i) => log[i]) : log;
  for (const op of seq) crdt.apply(op);
  return crdt;
}
