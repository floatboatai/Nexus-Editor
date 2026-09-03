import {
  asDocumentId,
  createCollaborationEngine,
  type CollaborativeDocumentHandle,
  type CollaborationEngine,
  type CollaborationEngineOptions,
  type CollaborationOpenOptions,
  type EditorBindingAccess,
  type EditorBindingHandle,
  type ProjectionMetadataEntry,
  type ProjectionMetadataStore,
  type ReplicaStoreCheckpoint,
} from "../src/index";
import {
  createAssessmentMemoryStore,
  createAssessmentProviderHub,
  type AssessmentMemoryStore,
  type AssessmentProviderHub,
} from "../src/assessment";
import {
  createHocuspocusProviderFactory,
  type HocuspocusCollaborationProvider,
  type HocuspocusProviderControl,
  type HocuspocusProviderFactoryOptions,
} from "../src/hocuspocus-provider";
import {
  createIndexedDbReplicaStore,
  type IndexedDbReplicaStore,
  type IndexedDbReplicaStoreOptions,
} from "../src/indexeddb-store";

const provider: AssessmentProviderHub = createAssessmentProviderHub();
const store: AssessmentMemoryStore = createAssessmentMemoryStore();
const options: CollaborationEngineOptions = { providers: provider.factory, store };
const engine: CollaborationEngine = createCollaborationEngine(options);
const documentId = asDocumentId("public-consumer-document");
const networkOptions: HocuspocusProviderFactoryOptions = {
  url: "wss://collaboration.example.test",
  token: async () => "host-issued-short-lived-token",
};
const networkProvider: HocuspocusCollaborationProvider = createHocuspocusProviderFactory(networkOptions);
const networkControl: HocuspocusProviderControl = networkProvider.control;
const browserStoreOptions: IndexedDbReplicaStoreOptions = {
  databaseName: "public-consumer-collaboration",
};
const createBrowserStore: () => IndexedDbReplicaStore = () =>
  createIndexedDbReplicaStore(browserStoreOptions);
const checkpoint: ReplicaStoreCheckpoint = {
  generation: "public-consumer-generation",
  sequence: 0,
};
const bindingAccess: EditorBindingAccess = "read-only";
const authenticatedJoin: CollaborationOpenOptions = {
  readiness: "require-authenticated-sync",
};

function forgetProjectionBase(
  metadata: ProjectionMetadataStore,
  expected: ProjectionMetadataEntry,
): Promise<boolean> {
  return metadata.delete(expected.record, expected.revision);
}

async function consume(): Promise<void> {
  const document: CollaborativeDocumentHandle = await engine.create(
    { id: documentId, hostIdentity: "consumer" },
    { initialMarkdown: "hello" },
  );
  const binding = null as EditorBindingHandle | null;
  await binding?.detach();
  await document.close();
}

void consume;
void networkProvider;
void networkControl;
void createBrowserStore;
void checkpoint;
void bindingAccess;
void authenticatedJoin;
void forgetProjectionBase;
