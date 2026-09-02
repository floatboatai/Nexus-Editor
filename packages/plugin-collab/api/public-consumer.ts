import {
  asDocumentId,
  createCollaborationEngine,
  type CollaborativeDocumentHandle,
  type CollaborationEngine,
  type CollaborationEngineOptions,
  type EditorBindingHandle,
} from "../src/index";
import {
  createAssessmentMemoryStore,
  createAssessmentProviderHub,
  type AssessmentMemoryStore,
  type AssessmentProviderHub,
} from "../src/assessment";

const provider: AssessmentProviderHub = createAssessmentProviderHub();
const store: AssessmentMemoryStore = createAssessmentMemoryStore();
const options: CollaborationEngineOptions = { providers: provider.factory, store };
const engine: CollaborationEngine = createCollaborationEngine(options);
const documentId = asDocumentId("public-consumer-document");

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
