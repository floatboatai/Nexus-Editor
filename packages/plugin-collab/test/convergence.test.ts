/**
 * Convergence property test (CI-gated, formal version).
 *
 * Mirrors `convergence.sim.mjs` but uses fast-check to shrink the search space
 * and to satisfy the proposition's "用 fast-check 生成 (clientId, op, timestamp)
 * 序列 … 对同一序列的不同网络调度顺序各跑一遍，断言最终文档哈希一致 + 最终偏移映射一致".
 *
 * Run with: pnpm --filter @floatboat/nexus-plugin-collab test
 */
import { test } from "vitest";
import * as fc from "fast-check";
import {
  generateOpLog,
  applyLogInOrder,
  hashText,
  shuffled,
  mulberry32,
} from "../src/provider/tree-crdt";

test.prop([
  fc.integer({ min: 2, max: 8 }), // clients
  fc.integer({ min: 5, max: 60 }), // ops per client
  fc.integer({ min: 2, max: 20 }), // delivery orders to compare
])("documents converge across all delivery orders (content + offset map)", (clients, opsPerClient, orders) => {
  const seed = (clients * 100003 + opsPerClient * 7919 + orders * 31) >>> 0;
  const log = generateOpLog({ clients, opsPerClient, seed, deleteRatio: 0.2 });

  const rng = mulberry32(seed ^ 0x9e3779b9);
  let firstTextHash: string | null = null;
  let firstMapHash: string | null = null;

  for (let o = 0; o < orders; o++) {
    const { text, offsetMap } = applyLogInOrder(shuffled(log, rng)).render();
    const textHash = hashText(text);
    const mapHash = hashText(JSON.stringify(offsetMap));
    if (firstTextHash === null) {
      firstTextHash = textHash;
      firstMapHash = mapHash;
      continue;
    }
    if (textHash !== firstTextHash || mapHash !== firstMapHash) {
      throw new Error(
        `divergence: order ${o} produced text=${textHash} map=${mapHash} (expected text=${firstTextHash} map=${firstMapHash})`,
      );
    }
  }
  // sanity: there should be real content
  if (firstTextHash === hashText("")) {
    throw new Error("trivially empty document — generator produced no visible text");
  }
});

test("duplicate (re-delivered) updates are idempotent", () => {
  const log = generateOpLog({ clients: 3, opsPerClient: 20, seed: 5, deleteRatio: 0.2 });
  const a = applyLogInOrder(log);
  const b = applyLogInOrder(log);
  // re-apply the same ops a second time on b (simulating at-least-once delivery)
  for (const op of log) b.apply(op);
  const ra = a.render();
  const rb = b.render();
  if (ra.text !== rb.text) throw new Error("idempotency broken on text");
  if (JSON.stringify(ra.offsetMap) !== JSON.stringify(rb.offsetMap)) throw new Error("idempotency broken on offset map");
});
