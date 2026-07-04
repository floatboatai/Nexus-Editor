/**
 * Live-preview widget for rendered mention nodes.
 */

import type { WidgetDefinition, WidgetRenderContext } from "@floatboat/nexus-core";
import type { MentionMdastNode } from "./mention-types";

export interface MentionWidgetOptions {
  chipClass?: string;
  onClick?: (node: MentionMdastNode, ctx: WidgetRenderContext) => void;
}

export function createMentionWidgetDefinition(options: MentionWidgetOptions = {}): WidgetDefinition {
  const chipClass = options.chipClass ?? "nexus-mention-chip";

  return {
    nodeType: "mention",
    block: false,
    ignoreEvents: false,
    render(node: unknown, source: string, ctx?: WidgetRenderContext): HTMLElement {
      const mention = node as MentionMdastNode;
      const span = document.createElement("span");
      span.className = chipClass;
      span.dataset.mentionId = mention.id;
      span.dataset.mentionName = mention.name;
      span.setAttribute("role", "button");
      span.setAttribute("tabindex", "0");
      span.setAttribute("aria-label", `Mention: ${mention.name}`);
      span.title = mention.name;

      if (mention.avatar) {
        const img = document.createElement("img");
        img.src = mention.avatar;
        img.alt = "";
        img.className = "nexus-mention-chip-avatar";
        span.appendChild(img);
      }

      const name = document.createElement("span");
      name.className = "nexus-mention-chip-name";
      name.textContent = mention.name;
      span.appendChild(name);

      const handleActivate = () => {
        if (options.onClick) {
          options.onClick(mention, ctx!);
        } else if (ctx) {
          ctx.setSelection(ctx.from, ctx.to);
          ctx.focus();
        }
      };

      span.addEventListener("click", handleActivate);
      span.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      });

      return span;
    },
    destroy(element: HTMLElement): void {
      element.remove();
    },
  };
}
