import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";
import {
  createTemplateCommandsPlugin,
  createToolbarPlugin,
  insertInlineMath,
  insertMathBlock,
  insertMermaid,
  insertTable,
} from "../dist/index.js";

const plugins: NexusPlugin[] = [createToolbarPlugin(), createTemplateCommandsPlugin()];
const commands: readonly ((editor: EditorAPI) => boolean)[] = [insertTable, insertMathBlock, insertInlineMath, insertMermaid];
void plugins;
void commands;
