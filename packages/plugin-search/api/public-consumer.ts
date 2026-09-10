import type { EditorAPI } from "@floatboat/nexus-core";
import { createSearchPlugin } from "../dist/index";
import { rankNavigationItems } from "../dist/fuzzy";
import { SearchController, type SearchExecutor, type SearchSource } from "../dist/workspace";
import { createBrowserSearchExecutor } from "../dist/browser-worker";
import { createNodeSearchExecutor } from "../dist/node-worker";
import { createDocumentSearchController } from "../dist/headless";

const source: SearchSource = {
  list: async () => [{ id: "note", path: "Note.md", version: "1" }],
  read: async () => ({ content: "text", version: "1" }),
};
const executor: SearchExecutor = createNodeSearchExecutor();
const search = new SearchController({ source, executor });
void search.search({ text: "text", wholeWord: true });
void search.destroy();
void createBrowserSearchExecutor;
void rankNavigationItems([{ title: "Open", id: "open" }], "op")[0].id;
void createSearchPlugin({ ui: "headless" });

function bind(editor: EditorAPI, executor: SearchExecutor) {
  const controller = createDocumentSearchController(editor, { executor });
  void controller.ready;
  void controller.setQuery({ text: "text" });
  void controller.replaceAll("changed");
  return controller.dispose();
}
void bind;
