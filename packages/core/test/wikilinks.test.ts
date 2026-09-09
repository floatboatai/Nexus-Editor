import { describe, expect, it, vi } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { createGfmPreset } from "../../preset-gfm/src/index";
import {
  scanWikiLinks,
  parseWikiLinkTarget,
  stripWikiLinkAnchor,
  findAnchorPosition,
  collectMarkdownHeadings,
  collectMarkdownBlockIds,
  getWikiLinkTypingContext,
  createWikilinksExtension,
  createWikilinksPlugin,
  createEditor,
} from "../src/index";
import { createWikiLinkAutocompleteSource } from "../src/wikilinks";

describe("scanWikiLinks", () => {
  it("parses a plain wiki link", () => {
    const doc = "See [[MyNote]] end.";
    const matches = scanWikiLinks(doc);
    expect(matches).toHaveLength(1);
    expect(matches[0].target).toBe("MyNote");
    expect(matches[0].path).toBe("MyNote");
    expect(matches[0].anchor).toBeNull();
    expect(matches[0].alias).toBeUndefined();
    expect(matches[0].display).toBe("MyNote");
    expect(doc.slice(matches[0].from, matches[0].to)).toBe("[[MyNote]]");
    expect(doc.slice(matches[0].displayFrom, matches[0].displayTo)).toBe("MyNote");
  });

  it("parses an aliased wiki link", () => {
    const doc = "Prefix [[Real Target|visible]] suffix";
    const matches = scanWikiLinks(doc);
    expect(matches).toHaveLength(1);
    expect(matches[0].target).toBe("Real Target");
    expect(matches[0].alias).toBe("visible");
    expect(matches[0].display).toBe("visible");
    expect(doc.slice(matches[0].displayFrom, matches[0].displayTo)).toBe("visible");
  });

  it("skips escaped wiki links", () => {
    const matches = scanWikiLinks("prefix \\[[NotALink]] suffix");
    expect(matches).toHaveLength(0);
  });

  it("finds multiple links on the same line", () => {
    const matches = scanWikiLinks("[[A]] and [[B|bee]] and [[C]]");
    expect(matches.map((m) => m.target)).toEqual(["A", "B", "C"]);
    expect(matches[1].display).toBe("bee");
  });

  it("ignores bracketed text without double brackets", () => {
    expect(scanWikiLinks("[nope] [[ok]]")).toHaveLength(1);
  });

  it("does not match across newlines", () => {
    expect(scanWikiLinks("[[broken\nlink]]")).toHaveLength(0);
  });

  it("ignores empty target", () => {
    expect(scanWikiLinks("[[]]")).toHaveLength(0);
  });

  it("parses a heading anchor on a file target", () => {
    const matches = scanWikiLinks("See [[MyNote#Setup]] later");
    expect(matches).toHaveLength(1);
    expect(matches[0].target).toBe("MyNote#Setup");
    expect(matches[0].path).toBe("MyNote");
    expect(matches[0].anchor).toEqual({ kind: "heading", value: "Setup" });
    expect(matches[0].display).toBe("MyNote#Setup");
  });

  it("parses a nested heading path", () => {
    const matches = scanWikiLinks("[[Guide#Parent#Child]]");
    expect(matches[0].path).toBe("Guide");
    expect(matches[0].anchor).toEqual({ kind: "heading", value: "Parent#Child" });
  });

  it("parses a block-id anchor", () => {
    const matches = scanWikiLinks("[[Spec^blk-1]]");
    expect(matches[0].path).toBe("Spec");
    expect(matches[0].anchor).toEqual({ kind: "block", value: "blk-1" });
  });

  it("parses a same-file heading jump", () => {
    const doc = "jump [[#Local heading]] here";
    const matches = scanWikiLinks(doc);
    expect(matches).toHaveLength(1);
    expect(matches[0].target).toBe("#Local heading");
    expect(matches[0].path).toBe("");
    expect(matches[0].anchor).toEqual({ kind: "heading", value: "Local heading" });
    expect(matches[0].display).toBe("Local heading");
    expect(doc.slice(matches[0].displayFrom, matches[0].displayTo)).toBe("Local heading");
  });

  it("parses a same-file block jump", () => {
    const doc = "see [[^quote-1]] below";
    const matches = scanWikiLinks(doc);
    expect(matches[0].path).toBe("");
    expect(matches[0].anchor).toEqual({ kind: "block", value: "quote-1" });
    expect(matches[0].display).toBe("quote-1");
    expect(doc.slice(matches[0].displayFrom, matches[0].displayTo)).toBe("quote-1");
  });

  it("ignores a bare marker with no heading or block id", () => {
    expect(scanWikiLinks("[[#]] [[^]]")).toHaveLength(0);
  });
});

describe("parseWikiLinkTarget / stripWikiLinkAnchor", () => {
  it("returns the target unchanged when no anchor is present", () => {
    expect(parseWikiLinkTarget("Foo")).toEqual({ path: "Foo", anchor: null });
    expect(stripWikiLinkAnchor("Folder/Foo")).toBe("Folder/Foo");
  });

  it("splits heading and block anchors", () => {
    expect(parseWikiLinkTarget("Foo#Bar")).toEqual({
      path: "Foo",
      anchor: { kind: "heading", value: "Bar" },
    });
    expect(parseWikiLinkTarget("Foo^blk-1")).toEqual({
      path: "Foo",
      anchor: { kind: "block", value: "blk-1" },
    });
    expect(stripWikiLinkAnchor("Foo#Heading text")).toBe("Foo");
  });

  it("treats a leading marker as a same-file jump", () => {
    expect(parseWikiLinkTarget("#Bar")).toEqual({
      path: "",
      anchor: { kind: "heading", value: "Bar" },
    });
  });
});

describe("findAnchorPosition / collectors", () => {
  it("locates ATX headings case-insensitively", () => {
    const doc = "intro\n# First\ntext\n## Second section\nmore";
    const pos = findAnchorPosition(doc, { kind: "heading", value: "second  section" });
    expect(pos).not.toBeNull();
    expect(doc.slice(pos!).startsWith("## Second section")).toBe(true);
  });

  it("matches the last segment of a nested heading path", () => {
    const doc = "# Parent\ntext\n## Child\nmore";
    const pos = findAnchorPosition(doc, { kind: "heading", value: "Parent#Child" });
    expect(pos).not.toBeNull();
    expect(doc.slice(pos!).startsWith("## Child")).toBe(true);
  });

  it("locates block refs at end of line", () => {
    const doc = "first line\nanchor paragraph ^blk-1\nnext line";
    const pos = findAnchorPosition(doc, { kind: "block", value: "blk-1" });
    expect(pos).not.toBeNull();
    expect(doc.slice(pos!).startsWith("anchor paragraph")).toBe(true);
  });

  it("collects unique headings and block ids in document order", () => {
    const doc = "# Alpha\n## Beta\n# Alpha\npara ^one\nother ^one\nend ^two";
    expect(collectMarkdownHeadings(doc)).toEqual(["Alpha", "Beta"]);
    expect(collectMarkdownBlockIds(doc)).toEqual(["one", "two"]);
  });

  it("returns null when the heading or block id is missing", () => {
    const doc = "# Alpha\npara ^one";
    expect(findAnchorPosition(doc, { kind: "heading", value: "Gamma" })).toBeNull();
    expect(findAnchorPosition(doc, { kind: "block", value: "nope" })).toBeNull();
  });
});

describe("wikilinks decorations (rendered output)", () => {
  function mount(initialValue: string, opts: Parameters<typeof createWikilinksPlugin>[0] = {}) {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue,
      livePreview: false,
      plugins: [createWikilinksPlugin(opts)],
    });
    return { container, editor };
  }

  it("hides [[ ]] and shows the target as visible text when cursor is off the line", () => {
    const { container, editor } = mount("first line\nSee [[MyNote]] here\n\nend");
    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("MyNote");
    // Brackets should not be visible when cursor is elsewhere
    expect(text).not.toContain("[[");
    expect(text).not.toContain("]]");

    const span = container.querySelector("[data-wikilink-target]");
    expect(span).not.toBeNull();
    expect(span!.getAttribute("data-wikilink-target")).toBe("MyNote");
    editor.destroy();
  });

  it("shows raw [[ ]] when cursor is on the same line", () => {
    const { container, editor } = mount("Look at [[MyNote]] now\n\nend");
    editor.setSelection(10); // inside the first line
    const text = container.textContent ?? "";
    expect(text).toContain("[[MyNote]]");
    editor.destroy();
  });

  it("uses alias as visible text when provided, cursor off line", () => {
    const { container, editor } = mount("begin\n[[A Real Target|visible alias]]\n\nend");
    editor.setSelection(editor.getDocument().length);
    const text = container.textContent ?? "";
    expect(text).toContain("visible alias");
    expect(text).not.toContain("A Real Target");
    const span = container.querySelector("[data-wikilink-target]");
    expect(span!.getAttribute("data-wikilink-target")).toBe("A Real Target");
    editor.destroy();
  });

  it("marks unresolved links with the unresolved attribute", () => {
    const { container, editor } = mount("line 1\n[[Ghost]]\n\nend", {
      resolve: () => null,
    });
    editor.setSelection(editor.getDocument().length);
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.getAttribute("data-wikilink-unresolved")).toBe("true");
    editor.destroy();
  });

  it("marks resolved links without the unresolved attribute", () => {
    const { container, editor } = mount("line 1\n[[Real]]\n\nend", {
      resolve: (n) => (n === "Real" ? "/abs/Real.md" : null),
    });
    editor.setSelection(editor.getDocument().length);
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.getAttribute("data-wikilink-unresolved")).toBeNull();
    editor.destroy();
  });

  it("treats [[^block]] as resolved even when resolve returns null", () => {
    const { container, editor } = mount("line 1\n[[^quote-1]]\n\nend", {
      resolve: () => null,
    });
    editor.setSelection(editor.getDocument().length);
    const text = container.textContent ?? "";
    expect(text).toContain("quote-1");
    expect(text).not.toContain("[[");
    expect(text).not.toContain("^quote-1");
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    expect(span.getAttribute("data-wikilink-unresolved")).toBeNull();
    expect(span.getAttribute("data-wikilink-anchor-kind")).toBe("block");
    expect(span.getAttribute("data-wikilink-anchor")).toBe("quote-1");
    editor.destroy();
  });

  it("treats [[#heading]] as resolved even when resolve returns null", () => {
    const { container, editor } = mount("line 1\n[[#Local]]\n\nend", {
      resolve: () => null,
    });
    editor.setSelection(editor.getDocument().length);
    const text = container.textContent ?? "";
    expect(text).toContain("Local");
    expect(text).not.toContain("[[");
    expect(text).not.toContain("#Local");
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.getAttribute("data-wikilink-target")).toBe("#Local");
    expect(span.getAttribute("data-wikilink-unresolved")).toBeNull();
    expect(span.getAttribute("data-wikilink-anchor-kind")).toBe("heading");
    expect(span.getAttribute("data-wikilink-anchor")).toBe("Local");
    editor.destroy();
  });

  it("exposes path and heading on [[Note#Setup]] chips", () => {
    const { container, editor } = mount("line 1\n[[Note#Setup]]\n\nend", {
      resolve: (name) => (name.startsWith("Note") ? "/vault/Note.md" : null),
    });
    editor.setSelection(editor.getDocument().length);
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    expect(span.getAttribute("data-wikilink-path")).toBe("Note");
    expect(span.getAttribute("data-wikilink-anchor")).toBe("Setup");
    expect(span.getAttribute("data-wikilink-unresolved")).toBeNull();
    editor.destroy();
  });

  it("does not let live preview render [[target]] as a markdown shortcut link", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Back to [[index]].\n\nend",
      livePreview: true,
      plugins: [
        createWikilinksPlugin({
          resolve: (n) => (n === "index" ? "/vault/index.md" : null),
        }),
      ],
    });

    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("index");
    expect(text).not.toContain("[index]");
    expect(container.querySelector("[data-link-url]")).toBeNull();
    const wiki = container.querySelector("[data-wikilink-target]");
    expect(wiki).not.toBeNull();
    expect(wiki?.getAttribute("data-wikilink-target")).toBe("index");
    editor.destroy();
  });
});

describe("wikilinks navigation callback", () => {
  it("fires onNavigate with the target when clicked", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "intro\n[[Hello]]\n\nend",
      livePreview: false,
      plugins: [createWikilinksPlugin({ onNavigate, resolve: () => "/x/Hello.md" })],
    });
    editor.setSelection(editor.getDocument().length);

    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    expect(span).not.toBeNull();
    const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    span.dispatchEvent(mousedown);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("Hello", {
      unresolved: false,
      path: "Hello",
      anchor: null,
    });
    editor.destroy();
  });

  it("reports unresolved=true when resolve returns null", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start\n[[Ghost]]\n\nend",
      livePreview: false,
      plugins: [createWikilinksPlugin({ onNavigate, resolve: () => null })],
    });
    editor.setSelection(editor.getDocument().length);
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith("Ghost", {
      unresolved: true,
      path: "Ghost",
      anchor: null,
    });
    editor.destroy();
  });

  it("passes parsed heading anchors through onNavigate", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start\n[[Guide#Setup]]\n\nend",
      livePreview: false,
      plugins: [createWikilinksPlugin({ onNavigate, resolve: () => "/x/Guide.md" })],
    });
    editor.setSelection(editor.getDocument().length);
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith("Guide#Setup", {
      unresolved: false,
      path: "Guide",
      anchor: { kind: "heading", value: "Setup" },
    });
    editor.destroy();
  });

  it("passes parsed block anchors through onNavigate", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start\n[[Spec^blk-1]]\n\nend",
      livePreview: false,
      plugins: [createWikilinksPlugin({ onNavigate, resolve: () => "/x/Spec.md" })],
    });
    editor.setSelection(editor.getDocument().length);
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith("Spec^blk-1", {
      unresolved: false,
      path: "Spec",
      anchor: { kind: "block", value: "blk-1" },
    });
    editor.destroy();
  });

  it("navigates [[^quote-1]] under live preview instead of treating it as a footnote", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "See [[^quote-1]] here\n\nA paragraph. ^quote-1\n",
      livePreview: true,
      plugins: [
        createGfmPreset(),
        createWikilinksPlugin({ onNavigate, resolve: () => null }),
      ],
    });
    editor.setSelection(editor.getDocument().length);
    const span = container.querySelector("[data-wikilink-target]") as HTMLElement;
    expect(span).not.toBeNull();
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith("^quote-1", {
      unresolved: false,
      path: "",
      anchor: { kind: "block", value: "quote-1" },
    });
    editor.destroy();
  });
});

describe("wikilinks autocomplete", () => {
  it("describes an open [[query as a note completion context", () => {
    const ctx = getWikiLinkTypingContext("line\n[[ap", "line\n[[ap".length);
    expect(ctx).toEqual({
      openFrom: "line\n".length,
      query: "ap",
      path: "ap",
      anchor: null,
    });
  });

  it("splits heading and block queries at the first marker", () => {
    expect(getWikiLinkTypingContext("[[Note#He", "[[Note#He".length)).toEqual({
      openFrom: 0,
      query: "Note#He",
      path: "Note",
      anchor: { kind: "heading", query: "He", markerIndex: 4 },
    });
    expect(getWikiLinkTypingContext("[[#Lo", "[[#Lo".length)?.anchor).toEqual({
      kind: "heading",
      query: "Lo",
      markerIndex: 0,
    });
    expect(getWikiLinkTypingContext("[[Spec^bl", "[[Spec^bl".length)?.anchor).toEqual({
      kind: "block",
      query: "bl",
      markerIndex: 4,
    });
  });

  it("starts heading completion immediately after the # marker", () => {
    const ctx = getWikiLinkTypingContext("[[Guide#Su", "[[Guide#Su".length);
    expect(ctx).not.toBeNull();
    expect(ctx!.openFrom + 2 + ctx!.anchor!.markerIndex + 1).toBe("[[Guide#".length);
  });

  it("treats [[# with no heading text as a same-file heading query", () => {
    expect(getWikiLinkTypingContext("[[#", 3)).toEqual({
      openFrom: 0,
      query: "#",
      path: "",
      anchor: { kind: "heading", query: "", markerIndex: 0 },
    });
    expect(getWikiLinkTypingContext("[[^", 3)?.anchor).toEqual({
      kind: "block",
      query: "",
      markerIndex: 0,
    });
  });

  it("calls suggestAnchors for [[# instead of suggest", async () => {
    const suggest = vi.fn(() => ["Index"]);
    const suggestAnchors = vi.fn(() => ["Index", "Projects", "People"]);
    const source = createWikiLinkAutocompleteSource(suggest, suggestAnchors);
    const doc = "[[#";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
    });
    const result = await source(new CompletionContext(state, doc.length, true));
    expect(suggest).not.toHaveBeenCalled();
    expect(suggestAnchors).toHaveBeenCalledWith({ path: "", kind: "heading", query: "" });
    expect(result?.from).toBe(3);
    expect(result?.options.map((option) => option.label)).toEqual(["Index", "Projects", "People"]);
  });

  it("calls suggestAnchors for same-file and cross-file block queries", async () => {
    const suggest = vi.fn(() => ["Spec"]);
    const suggestAnchors = vi.fn(() => ["quote-1", "standup"]);
    const source = createWikiLinkAutocompleteSource(suggest, suggestAnchors);

    const sameFile = await source(new CompletionContext(
      EditorState.create({ doc: "[[^", selection: EditorSelection.cursor(3) }),
      3,
      true,
    ));
    expect(suggestAnchors).toHaveBeenCalledWith({ path: "", kind: "block", query: "" });
    expect(sameFile?.from).toBe(3);

    const crossFile = await source(new CompletionContext(
      EditorState.create({ doc: "[[Spec^st", selection: EditorSelection.cursor("[[Spec^st".length) }),
      "[[Spec^st".length,
      true,
    ));
    expect(suggestAnchors).toHaveBeenCalledWith({ path: "Spec", kind: "block", query: "st" });
    expect(crossFile?.from).toBe("[[Spec^".length);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("invalidates note completions when # or ^ is typed", async () => {
    const source = createWikiLinkAutocompleteSource(() => ["Index"], () => ["Projects"]);
    const doc = "[[";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
    });
    const result = await source(new CompletionContext(state, doc.length, true));
    const validFor = result?.validFor;
    expect(validFor).toBeInstanceOf(RegExp);
    const pattern = validFor as RegExp;
    expect(pattern.test("In")).toBe(true);
    expect(pattern.test("#")).toBe(false);
    expect(pattern.test("Note#")).toBe(false);
    expect(pattern.test("Note^")).toBe(false);
  });

  it("calls suggest with the query typed after [[", async () => {
    const suggest = vi.fn((_query: string) => ["Apple", "Banana", "Avocado"]);
    const state = EditorState.create({
      doc: "line\n[[ap",
      selection: EditorSelection.cursor("line\n[[ap".length),
      extensions: [createWikilinksExtension({ suggest })],
    });

    const view = new EditorView({ state });
    view.focus();

    const matches = scanWikiLinks(state.doc.toString());
    expect(matches).toHaveLength(0);
    view.destroy();

    const result = suggest("ap");
    expect(result).toContain("Apple");
    expect(result).toContain("Avocado");
  });
});
