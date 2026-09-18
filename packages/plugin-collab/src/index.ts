/**
 * `@floatboat/nexus-plugin-collab` — CRDT-driven real-time collaboration for
 * Nexus-Editor. Offline-first, awareness-aware, replayable history, and a
 * deterministic convergence test suite. Integrates through public capabilities
 * only (no core changes).
 */

export {
  CollabPlugin,
  collabPluginManifest,
  loopbackTransport,
  ANNOTATION_SOURCE,
  type CollabPluginOptions,
  type CollabTransport,
} from "./plugin";

export {
  LocalTreeCrdtProvider,
  encodeOps,
  decodeOps,
  renderCrdt,
  type AwarenessState,
  type AwarenessAdapter,
  type CollabProviderAdapter,
  type CollabDocument,
  type Disposer,
} from "./provider/adapter";

export {
  TreeCrdt,
  generateOpLog,
  applyLogInOrder,
  shuffled,
  hashText,
  mulberry32,
  type CollabOp,
  type InsertOp,
  type DeleteOp,
  type UpdateMeta,
  type OpSource,
  type RenderResult,
} from "./provider/tree-crdt";

export {
  VersionedMarkdownCodec,
  NodeOffsetIndex,
  CODEC_VERSION,
  CodecError,
  type MarkdownCollabCodec,
  type CollabSnapshot,
  type CodecFormat,
} from "./codec/markdown-codec";

export {
  CollabStorage,
  type CollabStorageState,
  type KeyValueStore,
} from "./storage/indexeddb";

export { createRemoteCursorExtension } from "./awareness/remote-cursor";
export { mountCollabUI, type CollabUiHandle, type HostUi, type CollabUiModel, type ConnectionState } from "./ui/collab-ui";
export { sanitizeAwareness, guardRoomAccess, type AuthorizeHook } from "./security";
