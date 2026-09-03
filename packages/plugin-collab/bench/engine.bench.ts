import { createEditor, type EditorAPI, type EditorAuthoritativeSourceRegistration } from "@floatboat/nexus-core";
import { afterAll, beforeAll, bench } from "vitest";

import { asDocumentId, createCollaborationEngine, type CollaborationEngine, type CollaborativeDocumentHandle, type EditorBindingHandle } from "../src";
import { createAssessmentProviderHub, type AssessmentProviderHub } from "../src/assessment";

let hub: AssessmentProviderHub;
let leftEngine: CollaborationEngine;
let rightEngine: CollaborationEngine;
let leftDocument: CollaborativeDocumentHandle;
let rightDocument: CollaborativeDocumentHandle;
let leftEditor: EditorAPI;
let rightEditor: EditorAPI;
let leftBinding: EditorBindingHandle;
let rightBinding: EditorBindingHandle;
let authoritativeEditor: EditorAPI;
let authoritativeSource: EditorAuthoritativeSourceRegistration;

beforeAll(async () => {
  hub = createAssessmentProviderHub();
  leftEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
  rightEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
  const ref = { id: asDocumentId("collaboration-benchmark"), hostIdentity: "benchmark" };
  leftDocument = await leftEngine.create(ref, { initialMarkdown: "benchmark" });
  rightDocument = await rightEngine.open(ref);
  leftEditor = createEditor({ container: document.createElement("div"), initialValue: "benchmark" });
  rightEditor = createEditor({ container: document.createElement("div"), initialValue: "benchmark" });
  leftBinding = await leftDocument.attach(leftEditor, { content: "require-match" });
  rightBinding = await rightDocument.attach(rightEditor, { content: "require-match" });
  authoritativeEditor = createEditor({ container: document.createElement("div"), initialValue: "benchmark" });
  authoritativeSource = authoritativeEditor.getContributionSink().registerAuthoritativeSource("benchmark", {
    undo: () => false,
    redo: () => false,
  });
  await authoritativeSource.ready;
});

afterAll(async () => {
  await leftBinding.detach();
  await rightBinding.detach();
  leftEditor.destroy();
  rightEditor.destroy();
  await authoritativeSource.dispose();
  authoritativeEditor.destroy();
  await leftDocument.close();
  await rightDocument.close();
  await leftEngine.close();
  await rightEngine.close();
  await hub.close();
});

bench("idle Engine create/close", async () => {
  const localHub = createAssessmentProviderHub();
  const engine = createCollaborationEngine({ providers: localHub.factory, store: { mode: "volatile" } });
  await engine.close();
  await localHub.close();
}, { time: 300, iterations: 20 });

bench("local proposal and two-Editor convergence", () => {
  leftEditor.dispatchTransaction({ changes: [{ from: 0, to: 0, insert: "x" }], origin: ["benchmark"] });
  leftEditor.dispatchTransaction({ changes: [{ from: 0, to: 1, insert: "" }], origin: ["benchmark"] });
  if (leftEditor.getDocument() !== rightEditor.getDocument()) throw new Error("benchmark projections diverged");
}, { time: 500, iterations: 50 });

bench("Core authoritative projection", () => {
  authoritativeSource.dispatch({ changes: [{ from: 0, to: 0, insert: "x" }], origin: ["benchmark"] });
  authoritativeSource.dispatch({ changes: [{ from: 0, to: 1, insert: "" }], origin: ["benchmark"] });
}, { time: 500, iterations: 50 });

bench("64 KiB collaborative Markdown replacement", () => {
  const before = leftEditor.getDocument();
  const large = `${"段落 🚀\n".repeat(8_000)}${before}`;
  leftEditor.dispatchTransaction({ changes: [{ from: 0, to: before.length, insert: large }], origin: ["benchmark-large"] });
  leftEditor.dispatchTransaction({ changes: [{ from: 0, to: large.length, insert: before }], origin: ["benchmark-large"] });
  if (leftEditor.getDocument() !== rightEditor.getDocument()) throw new Error("large benchmark projections diverged");
}, { time: 300, iterations: 10 });
