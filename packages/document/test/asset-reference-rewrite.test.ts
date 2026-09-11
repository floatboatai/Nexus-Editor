import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { rewriteAssetReferences } from "../src/assets";

const asset = "nexus-asset:import/1";
const destination = "_assets/image.png";

describe("source-preserving attachment rewrites", () => {
  it("leaves unrelated frontmatter, whitespace, CRLF and EOF formatting byte-for-byte intact", () => {
    const prefix = '\ufeff---\r\ntitle:   "Spacing"\r\nexample: "![sample](nexus-asset:import/1)"\r\n---\r\n\r\n#    Heading   \r\n\r\n';
    const suffix = "  \r\n\r\n-   item\r\n    continuation\r\n\r\n";
    const input = `${prefix}![alt](  ${asset}   "a title" )${suffix}`;
    expect(rewriteAssetReferences(input, { [asset]: destination })).toBe(`${prefix}![alt](  ${destination}   "a title" )${suffix}`);
  });

  it("changes only destinations when labels, titles, prose and code contain the same logical ID", () => {
    const input = `![${asset}](${asset} '${asset}')\n\n${asset}\n\`${asset}\`\n\n~~~md\n![code](${asset})\n~~~`;
    const expected = `![${asset}](${destination} '${asset}')\n\n${asset}\n\`${asset}\`\n\n~~~md\n![code](${asset})\n~~~`;
    expect(rewriteAssetReferences(input, { [asset]: destination })).toBe(expected);
  });

  it("preserves table alignment and rewrites shared reference definitions, including nested definitions", () => {
    const input = `| A      |B|\n|:-------|--:|\n|![x](<${asset}> "t")|  1 |\n\n![one][pic] and [two][pic]\n\n[pic]:\n  <${asset}>   'title'\n\n> [nested]: ${asset}\n`;
    const expected = `| A      |B|\n|:-------|--:|\n|![x](<${destination}> "t")|  1 |\n\n![one][pic] and [two][pic]\n\n[pic]:\n  <${destination}>   'title'\n\n> [nested]: ${destination}\n`;
    expect(rewriteAssetReferences(input, { [asset]: destination })).toBe(expected);
  });

  it("does not rewrite a definition label or an image reference label", () => {
    const input = `![x][${asset}]\n\n[${asset}]: ${asset} "${asset}"\n`;
    expect(rewriteAssetReferences(input, { [asset]: destination })).toBe(`![x][${asset}]\n\n[${asset}]: ${destination} "${asset}"\n`);
  });

  it("uses decoded tokenizer destinations for character references and backslash escapes", () => {
    const escaped = "nexus-asset:import/(two)";
    const input = `![one](nexus-asset:import/&#49;) ![two](nexus-asset:import/\\(two\\))`;
    expect(rewriteAssetReferences(input, { [asset]: destination, [escaped]: "_assets/two.png" })).toBe(`![one](${destination}) ![two](_assets/two.png)`);
  });

  it("keeps BOM and UTF-16 offsets correct without frontmatter", () => {
    const input = `\ufeff😀 中文 ![图](${asset})。\r\n`;
    expect(rewriteAssetReferences(input, { [asset]: destination })).toBe(`\ufeff😀 中文 ![图](${destination})。\r\n`);
  });

  it("escapes new destination syntax without changing image labels or titles", () => {
    const output = rewriteAssetReferences(`![alt](${asset} "title")`, { [asset]: "_assets/a b(c)&copy;|x.png" });
    const tree = unified().use(remarkParse).use(remarkGfm).parse(output);
    const paragraph = tree.children[0];
    const image = paragraph.type === "paragraph" ? paragraph.children[0] : null;
    expect(image).toMatchObject({ type: "image", alt: "alt", title: "title", url: "_assets/a%20b%28c%29&copy;%7Cx.png" });
  });

  it("returns an unchanged source when no real resource URL needs rewriting", () => {
    const input = `---\nexample: '![x](${asset})'\n---\n\n    ![code](${asset})\n\n\`${asset}\`\n\n![bad](${asset} "unterminated)\n`;
    expect(rewriteAssetReferences(input, {})).toBe(input);
  });

  it("preserves visible autolink text while making its committed relative target a valid link", () => {
    const input = `Before <${asset}> after`;
    expect(rewriteAssetReferences(input, { [asset]: destination })).toBe(`Before [${asset}](${destination}) after`);
  });

  it("still rejects missing, absolute, protocol and NUL destinations", () => {
    for (const value of [undefined, "/outside.png", "https://example.invalid/a.png", "x\0y"]) {
      expect(() => rewriteAssetReferences(`![x](${asset})`, value === undefined ? {} : { [asset]: value })).toThrow("relative committed destination");
    }
  });
});
