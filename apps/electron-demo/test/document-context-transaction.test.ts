import { describe, expect, it, vi } from "vitest";

import {
  createDocumentContextTransactions,
} from "../src/renderer/document-context-transaction";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("document context transactions", () => {
  it("serializes collaboration opening behind a context change and rejects its stale capture", async () => {
    let identity = "vault-a:Notes/A.md";
    const transactions = createDocumentContextTransactions(() => identity);
    const releaseChange = deferred<void>();
    const change = transactions.runContextChange(async () => {
      await releaseChange.promise;
      identity = "vault-a:Notes/B.md";
    });
    const captured = transactions.capture();
    const opening = vi.fn(async (_validate: () => void) => undefined);
    const create = transactions.runOpening(captured, opening);

    await Promise.resolve();
    expect(opening).not.toHaveBeenCalled();

    releaseChange.resolve();
    await change;
    await expect(create).rejects.toMatchObject({ code: "document-context-changed" });
    expect(opening).not.toHaveBeenCalled();
  });

  it("provides an epoch validator that remains valid for the whole opening reservation", async () => {
    const transactions = createDocumentContextTransactions(() => "vault-a:Notes/A.md");
    const captured = transactions.capture();
    const validate = vi.fn();

    await transactions.runOpening(captured, async (assertCurrent) => {
      assertCurrent();
      validate();
      assertCurrent();
    });

    expect(validate).toHaveBeenCalledTimes(1);
  });
});
