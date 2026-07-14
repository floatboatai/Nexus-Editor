import { describe, expect, it } from "vitest";

import { lezerStringToMdast } from "../src/lezer-mdast-adapter";
import { renderPreviewHtml } from "../src/live-preview-to-html";

describe("renderPreviewHtml", () => {
  it("tags top-level block elements with their source offset", () => {
    const markdown = "# Heading\n\nA paragraph.";
    const ast = lezerStringToMdast(markdown);

    const html = renderPreviewHtml(ast);

    const headingOffset = ast.children[0].position?.start.offset;
    const paragraphOffset = ast.children[1].position?.start.offset;
    expect(html).toContain(`data-offset="${headingOffset}"`);
    expect(html).toContain(`data-offset="${paragraphOffset}"`);
  });

  it("preserves inline formatting nested inside a block", () => {
    const markdown = "# A **bold** [link](https://example.com) heading";
    const ast = lezerStringToMdast(markdown);

    const html = renderPreviewHtml(ast);

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it("renders a code block's content as plain text", () => {
    const markdown = "```js\nconst x = 1;\n```";
    const ast = lezerStringToMdast(markdown);

    const html = renderPreviewHtml(ast);

    expect(html).toContain("const x = 1;");
  });

  it("does not specially render wiki-link syntax (v1 limitation)", () => {
    // [[...]] is not a real mdast node (wikilinks.ts is CM6-decoration-only).
    // The outer bracket pair passes through as literal text; the inner
    // [Some Note] is parsed as an unresolved CommonMark shortcut-reference
    // link by the underlying Lezer→mdast adapter (a pre-existing, unrelated
    // quirk — see design.md) rather than becoming a wiki-link. This test
    // pins the actual behavior so a future adapter fix has a regression
    // guard here too, not just a claim in the spec.
    const markdown = "See [[Some Note]] for details.";
    const ast = lezerStringToMdast(markdown);

    const html = renderPreviewHtml(ast);

    expect(html).toContain("[<a");
    expect(html).toContain(">Some Note</a>]");
  });

  it("renders GFM table cells with their text and column alignment", () => {
    // Regression: the adapter used to emit `align: []` on table nodes.
    // mdast-util-to-hast's tableRow handler emits exactly `align.length`
    // cells per row, so an empty align array rendered every row cell-less —
    // tables showed as empty <tr></tr> shells in the preview.
    const markdown = "| Name | Age |\n| :--- | ---: |\n| Alice | 30 |";
    const html = renderPreviewHtml(lezerStringToMdast(markdown));

    expect(html).toContain('<th align="left">Name</th>');
    expect(html).toContain('<th align="right">Age</th>');
    expect(html).toContain('<td align="left">Alice</td>');
    expect(html).toContain('<td align="right">30</td>');
  });

  it("renders task-list item text, checkbox state, and inline formatting", () => {
    // Regression: Lezer keeps plain text implicit in the gaps between nodes,
    // and a Task node's only structural child is its TaskMarker — the
    // adapter's old block-child walk over Task found nothing, so task items
    // rendered as a bare checkbox with no text.
    const markdown = "- [ ] buy **fresh** milk\n- [x] write code";
    const html = renderPreviewHtml(lezerStringToMdast(markdown));

    expect(html).toContain('<input type="checkbox" disabled> buy <strong>fresh</strong> milk');
    expect(html).toContain('<input type="checkbox" checked disabled> write code');
  });

  it("keeps nested blocks under a task item", () => {
    const markdown = "- [ ] parent task\n  - child bullet";
    const html = renderPreviewHtml(lezerStringToMdast(markdown));

    expect(html).toContain("parent task");
    expect(html).toContain("<li>child bullet</li>");
  });

  it("does not mutate the input AST", () => {
    const markdown = "# Heading";
    const ast = lezerStringToMdast(markdown);
    const before = JSON.stringify(ast);

    renderPreviewHtml(ast);

    expect(JSON.stringify(ast)).toBe(before);
  });

  it("returns an empty-safe result for a document with no content", () => {
    const ast = lezerStringToMdast("");

    expect(() => renderPreviewHtml(ast)).not.toThrow();
  });
});
