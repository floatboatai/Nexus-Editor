import { describe, expectTypeOf, it } from "vitest";

import type { NexusEditorElement } from "../src/index";
import type { NexusIframeBridgeErrorCode, NexusIframeController } from "../src/iframe-parent";
import type { NexusIframeRuntimeOptions } from "../src/iframe-runtime";

describe("web component public types", () => {
  it("types the default tag and custom event details", () => {
    const element = document.querySelector("nexus-editor");
    expectTypeOf(element).toEqualTypeOf<NexusEditorElement | null>();

    element?.addEventListener("nexus-change", (event) => {
      expectTypeOf(event.detail.doc).toEqualTypeOf<string>();
    });
  });

  it("types the iframe parent and runtime entry points", () => {
    expectTypeOf<NexusIframeController["getDocument"]>().returns.resolves.toEqualTypeOf<string>();
    expectTypeOf<NexusIframeController["setDocument"]>().parameter(0).toEqualTypeOf<string>();
    expectTypeOf<NexusIframeRuntimeOptions["allowedParentOrigin"]>().toEqualTypeOf<string>();
    expectTypeOf<"TIMEOUT" | "IFRAME_RELOADED">().toMatchTypeOf<NexusIframeBridgeErrorCode>();
  });
});
