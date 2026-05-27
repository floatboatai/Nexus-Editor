
import type { EditorAPI, NexusPlugin, SlashCommandDef } from "@floatboat/nexus-core";
import { streamAIPolish, parseAIResponse, type AIConfig, type AIProvider } from "./ai-service";
import { createConfirmDialog, message } from "@floatboat/nexus-plugin-ui";

export type { AIConfig, AIProvider };

export interface AIPluginOptions {
  config: AIConfig;
}

export function createAIPlugin(options: AIPluginOptions): NexusPlugin {
  return {
    name: "plugin-ai",
    slashCommands: [createPolishSlashCommand(options.config)],
  };
}

function createPolishSlashCommand(config: AIConfig): SlashCommandDef {
  return {
    id: "ai-polish",
    title: "AI 润色",
    description: "使用 AI 优化选中的文本",
    keywords: ["ai", "润色", "优化", "polish", "improve"],
    run: (editor) => {
      aiPolishHandler(editor, config).catch(console.error);
      return true;
    },
  };
}

export async function aiPolishHandler(
  editor: EditorAPI,
  config: AIConfig
): Promise<boolean> {
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  if (from === to) {
    message.warning("请先选中要润色的文本");
    return false;
  }

  if (!config.apiKey) {
    message.error("请先配置 AI API Key");
    return false;
  }

  const selectedText = editor.getDocument().slice(from, to);

  const dialog = createConfirmDialog({
    title: "AI 润色",
    originalText: selectedText,
    onConfirm: (selectedOption) => {
      editor.replaceSelection(selectedOption.text);
      editor.focus();
      dialog.destroy();
    },
    onCancel: () => {
      abort?.();
      dialog.destroy();
    },
  });

  document.body.appendChild(dialog.element);

  let abort: (() => void) | undefined;
  let accumulatedText = "";

  abort = await streamAIPolish(selectedText, config, {
    onToken: (token) => {
      accumulatedText += token;
      dialog.updateStreamingText(accumulatedText);
    },
    onComplete: () => {
      dialog.setLoading(false);
      const parsed = parseAIResponse(accumulatedText);
      dialog.updateAIResponse(parsed);
    },
    onError: (error) => {
      dialog.setLoading(false);
      message.error(`润色失败: ${error.message}`);
      dialog.destroy();
    },
  });

  return true;
}

export { streamAIPolish, callAIPolish, parseAIResponse } from "./ai-service";
export { createConfirmDialog, message } from "@floatboat/nexus-plugin-ui";
