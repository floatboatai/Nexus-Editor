export function documentOperationKey(documentId: string): string {
  return `document:${documentId}`;
}

export function tokenOperationKey(tokenId: string): string {
  return `token:${tokenId}`;
}

export class DocumentOperationGate {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let resolveOwned!: () => void;
    const owned = new Promise<void>((resolve) => {
      resolveOwned = resolve;
    });
    const tail = previous.then(() => owned);
    this.tails.set(key, tail);
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      resolveOwned();
      void tail.then(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    };
  }

  async runExclusive<Result>(
    key: string,
    operation: () => Result | Promise<Result>,
  ): Promise<Result> {
    const release = await this.acquire(key);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
