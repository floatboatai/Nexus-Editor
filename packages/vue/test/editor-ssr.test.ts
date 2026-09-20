// @vitest-environment node
//
// Guards the SSR contract of `@floatboat/nexus-vue`: rendering <Editor /> on
// the server (Nuxt, ...) must produce the container markup without touching
// `document` or `window`. The CodeMirror instance is created only in
// `onMounted`, which never runs during server rendering.

import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { Editor } from "../src/index";

describe("<Editor /> server-side rendering", () => {
  it("renders the container element without a DOM", async () => {
    expect(typeof document).toBe("undefined");

    const app = createSSRApp({
      render: () => h(Editor, { initialValue: "# Hello", class: "nexus-editor" }),
    });
    const html = await renderToString(app);

    expect(html).toBe('<div class="nexus-editor"></div>');
  });
});
