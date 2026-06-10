import { describe, expect, it } from "vitest";

import { toCreateEditorConfig } from "../src/editor-config";

describe("toCreateEditorConfig", () => {
  it("strips onReady before passing config to createEditor", () => {
    const onReady = () => {};

    expect(
      toCreateEditorConfig({
        initialValue: "hello",
        readOnly: true,
        onReady
      })
    ).toEqual({
      initialValue: "hello",
      readOnly: true
    });
    expect(toCreateEditorConfig({ onReady })).toEqual({});
  });
});
