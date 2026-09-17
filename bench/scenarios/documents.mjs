/**
 * Deterministic document fixtures shared by the benchmark scenarios: a
 * realistic mix of headings, inline formatting, links, code blocks, lists and
 * task lists, scaled by repeating sections.
 */

export function section(index) {
  return [
    `## Section ${index}`,
    "",
    `Some **bold ${index}** text with a [link ${index}](https://example.com/${index}) and \`inline code ${index}\`.`,
    "",
    `- item ${index}a`,
    `- [ ] task ${index}b`,
    "",
  ].join("\n");
}

export function codeBlock(index) {
  const lines = Array.from({ length: 20 }, (_, line) => `const value${line}_${index} = ${index} * ${line};`);
  return "```js\n" + lines.join("\n") + "\n```\n\n";
}

/** Build a document of roughly `blocks` sections; every 5th section adds a code block. */
export function buildDocument(blocks) {
  let doc = "# Document\n\n";
  for (let i = 0; i < blocks; i++) {
    doc += section(i);
    if (i % 5 === 0) doc += codeBlock(i);
  }
  return doc;
}
