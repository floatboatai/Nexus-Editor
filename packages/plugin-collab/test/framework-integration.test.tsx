import type { EditorAPI } from "@floatboat/nexus-core";
import { useEditor as useReactEditor } from "@floatboat/nexus-react";
import { Editor as VueEditor } from "@floatboat/nexus-vue";
import { render, waitFor } from "@testing-library/react";
import { mount } from "@vue/test-utils";
import { useEffect } from "react";
import { defineComponent, h, onBeforeUnmount } from "vue";
import { describe, expect, it } from "vitest";

import {
  asDocumentId,
  createCollaborationEngine,
  type CollaborativeDocumentHandle,
  type EditorBindingHandle,
} from "../src";
import { createAssessmentProviderHub } from "../src/assessment";

async function setup(name: string) {
  const hub = createAssessmentProviderHub();
  const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
  const document = await engine.create(
    { id: asDocumentId(`framework-${name}`), hostIdentity: "framework-tests" },
    { initialMarkdown: "shared" },
  );
  return { hub, engine, document };
}

describe("framework lifecycle integration", () => {
  it("attaches through React useEditor and detaches through ordinary Binding cleanup", async () => {
    const resources = await setup("react");
    let editor: EditorAPI | null = null;
    let bound = false;

    function Harness({ document }: { document: CollaborativeDocumentHandle }) {
      const result = useReactEditor({ initialValue: "shared" });
      useEffect(() => {
        if (!result.editor) return;
        editor = result.editor;
        let active = true;
        let binding: EditorBindingHandle | null = null;
        void document.attach(result.editor, { content: "require-match" }).then((next) => {
          if (!active) return void next.detach();
          binding = next;
          bound = true;
        });
        return () => {
          active = false;
          void binding?.detach();
        };
      }, [document, result.editor]);
      return <div ref={result.containerRef} />;
    }

    const rendered = render(<Harness document={resources.document} />);
    await waitFor(() => expect(bound).toBe(true));
    editor!.dispatchTransaction({ changes: [{ from: 6, to: 6, insert: " react" }], origin: ["react"] });
    expect(resources.document.getMarkdown()).toBe("shared react");
    rendered.unmount();
    await waitFor(() => expect(resources.document.getState().bindings).toBe(0));

    await resources.document.close();
    await resources.engine.close();
    await resources.hub.close();
  });

  it("attaches through Vue onReady and detaches on unmount through the same handle", async () => {
    const resources = await setup("vue");
    let editor: EditorAPI | null = null;
    let binding: EditorBindingHandle | null = null;

    const Harness = defineComponent({
      setup() {
        onBeforeUnmount(() => { void binding?.detach(); });
        return () => h(VueEditor, {
          initialValue: "shared",
          onReady: async (ready: EditorAPI) => {
            editor = ready;
            binding = await resources.document.attach(ready, { content: "require-match" });
          },
        });
      },
    });

    const wrapper = mount(Harness);
    await waitFor(() => expect(binding).not.toBeNull());
    editor!.dispatchTransaction({ changes: [{ from: 6, to: 6, insert: " vue" }], origin: ["vue"] });
    expect(resources.document.getMarkdown()).toBe("shared vue");
    wrapper.unmount();
    await waitFor(() => expect(resources.document.getState().bindings).toBe(0));

    await resources.document.close();
    await resources.engine.close();
    await resources.hub.close();
  });
});
