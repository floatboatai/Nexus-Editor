// @vitest-environment node
//
// Guards the SSR contract of `@floatboat/nexus-react`: rendering <Editor /> on
// the server (Next.js, Remix, ...) must produce the container markup without
// touching `document` or `window`. The CodeMirror instance is created only
// inside an effect, which never runs during server rendering.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Editor } from "../src/index";

describe("<Editor /> server-side rendering", () => {
  it("renders the container element without a DOM", () => {
    expect(typeof document).toBe("undefined");

    const html = renderToString(
      <Editor initialValue="# Hello" className="nexus-editor" data-testid="editor" />,
    );

    expect(html).toBe('<div class="nexus-editor" data-testid="editor"></div>');
  });
});
