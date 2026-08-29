import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import type { EditorAPI } from "@floatboat/nexus-core";
import {
  insertHorizontalRule,
  toggleBlockquote,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
} from "../src/index";

function mount(initialValue: string): EditorAPI {
  const container = document.createElement("div");
  return createEditor({ container, initialValue });
}

/** Drives a command with an active IME composition, exactly like a CJK input method does. */
function composing<T>(editor: EditorAPI, container: HTMLElement, run: () => T): T {
  const content = container.querySelector(".cm-content");
  content?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  try {
    return run();
  } finally {
    content?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  }
}

describe("toggleBold — collapsed selection", () => {
  it("is a no-op in plain text", () => {
    const editor = mount("hello");

    editor.setSelection(2, 2);
    const handled = toggleBold(editor);

    expect(editor.getDocument()).toBe("hello");
    expect(handled).toBe(false);
    editor.destroy();
  });

  it("is a no-op inside an existing strong node", () => {
    const editor = mount("**hello**");

    editor.setSelection(5, 5);
    const handled = toggleBold(editor);

    expect(editor.getDocument()).toBe("**hello**");
    expect(handled).toBe(false);
    editor.destroy();
  });
});

describe("toggleBold — existing strong node", () => {
  it("removes the markers when the selection covers the node including them", () => {
    const editor = mount("**hello**");

    editor.setSelection(0, 9);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("removes the markers when the selection covers only the node content", () => {
    const editor = mount("**hello**");

    editor.setSelection(2, 7);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("moves the selected part out of strong and keeps the rest bold", () => {
    const editor = mount("**hello world**");

    editor.setSelection(2, 7);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("hello **world**");
    editor.destroy();
  });

  it("keeps the leading part bold when the tail is unbolded", () => {
    const editor = mount("**hello world**");

    editor.setSelection(8, 13);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**hello** world");
    editor.destroy();
  });
});

describe("toggleItalic — nesting", () => {
  it("does not turn bold into italic when toggling italic inside strong", () => {
    const editor = mount("**hello**");

    editor.setSelection(2, 7);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("***hello***");
    editor.destroy();
  });

  it("keeps the emphasis layer when strong is removed from ***text***", () => {
    const editor = mount("***hello***");

    editor.setSelection(3, 8);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("*hello*");
    editor.destroy();
  });

  it("keeps the strong layer when emphasis is removed from ***text***", () => {
    const editor = mount("***hello***");

    editor.setSelection(3, 8);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("**hello**");
    editor.destroy();
  });
});

describe("toggleBold — whitespace at the selection edges", () => {
  it("leaves a trailing space outside the markers", () => {
    const editor = mount("hello world");

    editor.setSelection(0, 6);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**hello** world");
    editor.destroy();
  });

  it("leaves a leading space outside the markers", () => {
    const editor = mount("hello world");

    editor.setSelection(5, 11);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("hello **world**");
    editor.destroy();
  });

  it("is a no-op when the selection is nothing but whitespace", () => {
    const editor = mount("hello world");

    editor.setSelection(5, 6);
    const handled = toggleBold(editor);

    expect(editor.getDocument()).toBe("hello world");
    expect(handled).toBe(false);
    editor.destroy();
  });
});

describe("toggleStrikethrough", () => {
  it("removes the markers when the selection covers the whole delete node", () => {
    const editor = mount("~~gone~~");

    editor.setSelection(0, 8);
    toggleStrikethrough(editor);

    expect(editor.getDocument()).toBe("gone");
    editor.destroy();
  });
});

describe("toggleInlineCode — backtick fences", () => {
  it("uses a longer fence when the content contains a backtick", () => {
    const editor = mount("a`b");

    editor.setSelection(0, 3);
    toggleInlineCode(editor);

    expect(editor.getDocument()).toBe("``a`b``");
    editor.destroy();
  });

  it("pads with spaces when the content starts with a backtick", () => {
    const editor = mount("`ab");

    editor.setSelection(0, 3);
    toggleInlineCode(editor);

    expect(editor.getDocument()).toBe("`` `ab ``");
    editor.destroy();
  });

  it("removes the fence when the selection covers an existing inlineCode node", () => {
    const editor = mount("`code`");

    editor.setSelection(1, 5);
    toggleInlineCode(editor);

    expect(editor.getDocument()).toBe("code");
    editor.destroy();
  });
});

describe("inline formatting — transaction shape", () => {
  it("applies bold while an IME composition is active", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(6, 11);
    composing(editor, container, () => toggleBold(editor));

    expect(editor.getDocument()).toBe("hello **world**");
    editor.destroy();
  });

  it("applies a blockquote while an IME composition is active", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.setSelection(0, 0);
    composing(editor, container, () => toggleBlockquote(editor));

    expect(editor.getDocument()).toBe("> hello");
    editor.destroy();
  });
});

describe("toggleBlockquote — multi-line selection", () => {
  it("prefixes every selected line", () => {
    const editor = mount("alpha\nbeta\ngamma");

    editor.setSelection(0, 16);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> alpha\n> beta\n> gamma");
    editor.destroy();
  });

  it("removes the prefix when every selected line already has one", () => {
    const editor = mount("> alpha\n> beta\n> gamma");

    editor.setSelection(0, 22);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("alpha\nbeta\ngamma");
    editor.destroy();
  });

  it("prefixes every line when only some of them are quoted", () => {
    const editor = mount("> alpha\nbeta");

    editor.setSelection(0, 12);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> > alpha\n> beta");
    editor.destroy();
  });

  it("keeps single-line toggling unchanged", () => {
    const editor = mount("alpha");

    editor.setSelection(3, 3);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> alpha");
    editor.destroy();
  });
});

describe("insertHorizontalRule", () => {
  it("does not turn the previous line into a setext heading", () => {
    const editor = mount("Title");

    editor.setSelection(5, 5);
    insertHorizontalRule(editor);

    expect(editor.getDocument()).toBe("Title\n\n---\n");
    editor.destroy();
  });

  it("does not turn the previous line into a setext heading from the next line", () => {
    const editor = mount("Title\n");

    editor.setSelection(6, 6);
    insertHorizontalRule(editor);

    expect(editor.getDocument()).toBe("Title\n\n---\n");
    editor.destroy();
  });

  it("does not add a second blank line when one is already there", () => {
    const editor = mount("Title\n\n");

    editor.setSelection(7, 7);
    insertHorizontalRule(editor);

    expect(editor.getDocument()).toBe("Title\n\n---\n");
    editor.destroy();
  });

  it("inserts without a leading blank line at the start of the document", () => {
    const editor = mount("");

    editor.setSelection(0, 0);
    insertHorizontalRule(editor);

    expect(editor.getDocument()).toBe("---\n");
    editor.destroy();
  });
});
