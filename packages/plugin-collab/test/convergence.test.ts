import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createSchema, getSchema, validateSchema } from "../src/schema";
import { asDocumentId } from "../src/types";

const documentRef = {
  id: asDocumentId("018f1f42-4bea-7a11-b6aa-9e922f009702"),
  hostIdentity: "convergence-fixture",
};

function replicaFrom(seed: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seed);
  expect(validateSchema(getSchema(doc), documentRef)).toBe("created");
  return doc;
}

describe("collaboration convergence", () => {
  it("converges duplicate, delayed, reordered, and partitioned Unicode updates", () => {
    const origin = new Y.Doc();
    createSchema(origin, getSchema(origin), documentRef, "A🙂中B\r\n");
    const seed = Y.encodeStateAsUpdate(origin);
    const replicas = [replicaFrom(seed), replicaFrom(seed), replicaFrom(seed)];
    const updates: Uint8Array[][] = replicas.map(() => []);
    replicas.forEach((doc, index) => {
      doc.on("update", (update) => updates[index]!.push(new Uint8Array(update)));
    });

    const [left, middle, right] = replicas.map((doc) => doc.getText("content"));
    left!.insert(1, "左🚀");
    middle!.delete(1, 2);
    right!.delete(3, 1);
    right!.insert(3, "右🧭");

    const schedule = [
      updates[2]![1]!,
      updates[0]![0]!,
      updates[2]![0]!,
      updates[1]![0]!,
      updates[0]![0]!,
      updates[2]![1]!,
    ];
    for (const doc of replicas) {
      for (const update of schedule) Y.applyUpdate(doc, update);
    }

    const expected = replicas[0]!.getText("content").toString();
    expect(replicas.map((doc) => doc.getText("content").toString())).toEqual([
      expected,
      expected,
      expected,
    ]);
    expect(expected).toContain("左🚀");
    expect(expected).toContain("右🧭");
    expect(expected).not.toContain("🙂");
    expect(expected).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    expect(expected.endsWith("\n")).toBe(true);
    expect(expected).not.toContain("\r");

    const lateJoiner = replicaFrom(seed);
    const delta = Y.encodeStateAsUpdate(replicas[0]!, Y.encodeStateVector(lateJoiner));
    Y.applyUpdate(lateJoiner, delta);
    Y.applyUpdate(lateJoiner, delta);
    expect(lateJoiner.getText("content").toString()).toBe(expected);

    lateJoiner.destroy();
    for (const doc of replicas) doc.destroy();
    origin.destroy();
  });
});
