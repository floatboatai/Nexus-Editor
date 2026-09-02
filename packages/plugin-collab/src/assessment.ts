import type {
  CollaborationProviderFactory,
  CollaborationReplicaPort,
  DocumentId,
  ProviderContext,
  ProviderLease,
  ProviderState,
  ReplicaStore,
  ReplicaStoreLease,
  Unsubscribe,
} from "./types";

const HUB_ORIGIN = Object.freeze({ kind: "nexus-assessment-provider" });

function bytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

interface Participant {
  readonly id: number;
  readonly documentId: DocumentId;
  readonly port: CollaborationReplicaPort;
  readonly listeners: Set<(state: ProviderState) => void>;
  readonly pending: Uint8Array[];
  state: ProviderState;
  started: boolean;
  released: boolean;
  stopDocument?: Unsubscribe;
  stopAwareness?: Unsubscribe;
  readonly initialReady: Promise<void>;
  resolveInitialReady(): void;
  readySettled: boolean;
}

export interface AssessmentProviderHub {
  readonly factory: CollaborationProviderFactory;
  setOnline(online: boolean): void;
  flush(): Promise<void>;
  inspect(): { readonly rooms: number; readonly participants: number; readonly queuedUpdates: number };
  close(): Promise<void>;
}

export function createAssessmentProviderHub(
  options: { readonly maxQueuedUpdates?: number } = {},
): AssessmentProviderHub {
  const rooms = new Map<DocumentId, Set<Participant>>();
  const participants = new Set<Participant>();
  const maxQueuedUpdates = options.maxQueuedUpdates ?? 256;
  let online = true;
  let closed = false;
  let sequence = 0;

  const publish = (participant: Participant, state: ProviderState): void => {
    participant.state = state;
    for (const listener of [...participant.listeners]) listener(state);
  };

  const markInitiallyReady = (participant: Participant): void => {
    if (participant.readySettled) return;
    participant.readySettled = true;
    participant.resolveInitialReady();
  };

  const roomFor = (documentId: DocumentId): Set<Participant> => {
    let room = rooms.get(documentId);
    if (!room) {
      room = new Set();
      rooms.set(documentId, room);
    }
    return room;
  };

  const forwardDocument = (sender: Participant, update: Uint8Array): void => {
    if (!online) {
      if (sender.pending.length >= maxQueuedUpdates) {
        publish(sender, {
          transport: "failed",
          sync: "failed",
          diagnostic: { code: "assessment-queue-overflow", message: "Assessment update queue is full" },
        });
        return;
      }
      sender.pending.push(bytes(update));
      publish(sender, { transport: "offline", sync: "stale" });
      return;
    }
    for (const peer of roomFor(sender.documentId)) {
      if (peer !== sender && peer.started && !peer.released) peer.port.applyUpdate(bytes(update), HUB_ORIGIN);
    }
  };

  const forwardAwareness = (sender: Participant, update: Uint8Array): void => {
    if (!online) return;
    for (const peer of roomFor(sender.documentId)) {
      if (peer !== sender && peer.started && !peer.released) peer.port.applyAwarenessUpdate(bytes(update), HUB_ORIGIN);
    }
  };

  const syncRoom = (room: Set<Participant>): void => {
    const active = [...room].filter((participant) => participant.started && !participant.released);
    for (let left = 0; left < active.length; left++) {
      for (let right = left + 1; right < active.length; right++) {
        const a = active[left];
        const b = active[right];
        a.port.applyUpdate(b.port.encodeStateAsUpdate(a.port.encodeStateVector()), HUB_ORIGIN);
        b.port.applyUpdate(a.port.encodeStateAsUpdate(b.port.encodeStateVector()), HUB_ORIGIN);
        const aClients = a.port.getAwarenessClientIds();
        const bClients = b.port.getAwarenessClientIds();
        if (aClients.length > 0) b.port.applyAwarenessUpdate(a.port.encodeAwarenessUpdate(aClients), HUB_ORIGIN);
        if (bClients.length > 0) a.port.applyAwarenessUpdate(b.port.encodeAwarenessUpdate(bClients), HUB_ORIGIN);
      }
    }
    for (const participant of active) {
      participant.pending.length = 0;
      publish(participant, { transport: "online", sync: "synced" });
      markInitiallyReady(participant);
    }
  };

  const release = async (participant: Participant): Promise<void> => {
    if (participant.released) return;
    participant.released = true;
    participant.stopDocument?.();
    participant.stopAwareness?.();
    participant.listeners.clear();
    participant.pending.length = 0;
    markInitiallyReady(participant);
    participants.delete(participant);
    const room = rooms.get(participant.documentId);
    room?.delete(participant);
    if (room?.size === 0) rooms.delete(participant.documentId);
  };

  const factory: CollaborationProviderFactory = {
    async prepare(context: ProviderContext): Promise<ProviderLease> {
      if (closed) throw new Error("Assessment Provider Hub is closed");
      let resolveInitialReady!: () => void;
      const initialReady = new Promise<void>((resolve) => {
        resolveInitialReady = resolve;
      });
      const participant: Participant = {
        id: ++sequence,
        documentId: context.document.id,
        port: context.replica,
        listeners: new Set(),
        pending: [],
        state: { transport: "idle", sync: "syncing" },
        started: false,
        released: false,
        initialReady,
        resolveInitialReady,
        readySettled: false,
      };
      participants.add(participant);
      return {
        async start() {
          if (participant.released) throw new Error("Assessment Provider lease is released");
          if (participant.started) {
            await participant.initialReady;
            return;
          }
          participant.started = true;
          const room = roomFor(participant.documentId);
          room.add(participant);
          participant.stopDocument = participant.port.onUpdate((update, origin) => {
            if (origin !== HUB_ORIGIN) forwardDocument(participant, update);
          });
          participant.stopAwareness = participant.port.onAwarenessUpdate((update, origin) => {
            if (origin !== HUB_ORIGIN) forwardAwareness(participant, update);
          });
          if (!online) {
            publish(participant, { transport: "offline", sync: "stale" });
            await participant.initialReady;
            return;
          }
          publish(participant, { transport: "connecting", sync: "syncing" });
          syncRoom(room);
          await participant.initialReady;
        },
        getState: () => participant.state,
        subscribe(listener) {
          participant.listeners.add(listener);
          return () => participant.listeners.delete(listener);
        },
        release: () => release(participant),
      };
    },
  };

  return {
    factory,
    setOnline(next) {
      if (closed || online === next) return;
      online = next;
      if (!online) {
        for (const participant of participants) {
          if (participant.started && !participant.released) {
            publish(participant, { transport: "offline", sync: "stale" });
          }
        }
        return;
      }
      for (const room of rooms.values()) syncRoom(room);
    },
    async flush() {
      if (!online) return;
      for (const room of rooms.values()) syncRoom(room);
      await Promise.resolve();
    },
    inspect: () => ({
      rooms: rooms.size,
      participants: participants.size,
      queuedUpdates: [...participants].reduce((total, participant) => total + participant.pending.length, 0),
    }),
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([...participants].map(release));
      rooms.clear();
    },
  };
}

export interface AssessmentMemoryStore extends ReplicaStore {
  inspect(): { readonly documents: number; readonly updates: number };
  close(): Promise<void>;
}

export function createAssessmentMemoryStore(
  options: { readonly maxUpdatesPerDocument?: number } = {},
): AssessmentMemoryStore {
  const updates = new Map<DocumentId, Uint8Array[]>();
  const maxUpdates = options.maxUpdatesPerDocument ?? 10_000;
  let closed = false;

  return {
    async open(documentId): Promise<ReplicaStoreLease> {
      if (closed) throw new Error("Assessment Memory Store is closed");
      let leaseClosed = false;
      const list = updates.get(documentId) ?? [];
      updates.set(documentId, list);
      return {
        async load() {
          if (leaseClosed) throw new Error("Assessment Store lease is closed");
          return { updates: list.map(bytes) };
        },
        async append(update) {
          if (leaseClosed) throw new Error("Assessment Store lease is closed");
          if (list.length >= maxUpdates) throw new Error("Assessment Store update limit exceeded");
          list.push(bytes(update));
        },
        async flush() {
          if (leaseClosed) throw new Error("Assessment Store lease is closed");
        },
        async replaceWithSnapshot(update) {
          if (leaseClosed) throw new Error("Assessment Store lease is closed");
          list.splice(0, list.length, bytes(update));
        },
        async close() {
          leaseClosed = true;
        },
      };
    },
    inspect: () => ({
      documents: updates.size,
      updates: [...updates.values()].reduce((total, list) => total + list.length, 0),
    }),
    async close() {
      closed = true;
      updates.clear();
    },
  };
}
