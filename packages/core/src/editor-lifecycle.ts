import type {
  EditorContributionRegistration,
  EditorDestroyListener,
  EditorLifecycleContributionSink,
} from "./types";

interface DestroyListenerEntry {
  readonly id: string;
  readonly ownerId: string;
  readonly listener: EditorDestroyListener;
  disposed: boolean;
}

function validateOwnerId(ownerId: string): void {
  if (ownerId.trim().length === 0) {
    throw new TypeError("Editor destroy listener ownerId must not be empty");
  }
}

/** Owner-scoped lifecycle registry kept separate from the Editor event emitter. */
export class EditorLifecycleContributionRegistry implements EditorLifecycleContributionSink {
  private readonly destroyListeners = new Map<string, DestroyListenerEntry>();
  private registrationId = 0;
  private destroyed = false;

  registerDestroyListener(
    ownerId: string,
    listener: EditorDestroyListener,
  ): EditorContributionRegistration {
    validateOwnerId(ownerId);
    if (this.destroyed) {
      throw new Error("Cannot register a destroy listener on a destroyed editor");
    }
    const id = `destroy-listener:${++this.registrationId}`;
    const entry: DestroyListenerEntry = { id, ownerId, listener, disposed: false };
    this.destroyListeners.set(id, entry);
    return {
      id,
      ownerId,
      ready: Promise.resolve(),
      get disposed() {
        return entry.disposed;
      },
      dispose: async () => {
        if (entry.disposed) return;
        entry.disposed = true;
        this.destroyListeners.delete(id);
      },
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const listeners = [...this.destroyListeners.values()];
    this.destroyListeners.clear();
    for (const entry of listeners) entry.disposed = true;
    for (const entry of listeners) {
      try {
        const result = entry.listener();
        if (result && typeof result.then === "function") {
          void Promise.resolve(result).catch((error) => {
            console.error(`[NexusEditor] Destroy listener failed (${entry.ownerId})`, error);
          });
        }
      } catch (error) {
        console.error(`[NexusEditor] Destroy listener failed (${entry.ownerId})`, error);
      }
    }
  }
}
