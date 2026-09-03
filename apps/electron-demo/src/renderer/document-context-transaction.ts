export interface DocumentContextSnapshot {
  readonly identity: string;
  readonly generation: number;
}

export interface DocumentContextTransactions {
  capture(): DocumentContextSnapshot;
  runContextChange<T>(operation: () => Promise<T>): Promise<T>;
  runOpening<T>(
    captured: DocumentContextSnapshot,
    operation: (assertContextCurrent: () => void) => Promise<T>,
  ): Promise<T>;
}

export class DocumentContextChangedError extends Error {
  readonly code = "document-context-changed";

  constructor() {
    super("The active document changed before collaboration could open");
    this.name = "DocumentContextChangedError";
  }
}

/**
 * Serializes Editor/Vault context changes with collaboration openings. The
 * generation protects against stale UI captures even when a path later cycles
 * back to the same string value.
 */
export function createDocumentContextTransactions(
  getIdentity: () => string,
): DocumentContextTransactions {
  let observedIdentity = getIdentity();
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();

  const observe = (): DocumentContextSnapshot => {
    const identity = getIdentity();
    if (identity !== observedIdentity) {
      observedIdentity = identity;
      generation += 1;
    }
    return Object.freeze({ identity: observedIdentity, generation });
  };

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const assertCurrent = (captured: DocumentContextSnapshot): void => {
    const current = observe();
    if (
      current.identity !== captured.identity
      || current.generation !== captured.generation
    ) {
      throw new DocumentContextChangedError();
    }
  };

  return Object.freeze({
    capture: observe,
    runContextChange: <T>(operation: () => Promise<T>) => serialize(async () => {
      observe();
      try {
        return await operation();
      } finally {
        observe();
      }
    }),
    runOpening: <T>(
      captured: DocumentContextSnapshot,
      operation: (validate: () => void) => Promise<T>,
    ) => serialize(async () => {
      const validate = () => assertCurrent(captured);
      validate();
      const result = await operation(validate);
      validate();
      return result;
    }),
  });
}
