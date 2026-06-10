import { describe, expect, it } from "vitest";

import { pickEditorConfig, toCreateEditorConfig } from "../src/editor-config";

describe("editor-config helpers", () => {
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
  });

  it("pickEditorConfig keeps defined editor props and drops undefined values", () => {
    expect(
      pickEditorConfig({
        initialValue: "hello",
        readOnly: true,
        onReady: () => {},
        plugins: undefined
      })
    ).toEqual({
      initialValue: "hello",
      readOnly: true,
      onReady: expect.any(Function)
    });
  });
});
