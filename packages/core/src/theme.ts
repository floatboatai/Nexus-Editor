import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** All customizable visual tokens for the editor. */
export interface NexusTheme {
  bg: string;
  bgSubtle: string;
  bgMuted: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderSubtle: string;
  accent: string;
  tooltipBg: string;
  tooltipText: string;
  hlKeyword: string;
  hlString: string;
  hlTitle: string;
  hlComment: string;
  hlNumber: string;
  hlType: string;
  hlDeletion: string;
  hlVariable: string;
  /** Font size in pixels for the editor content. Default: 15 */
  fontSize?: number;
  /** Font family for prose content. Default: system-ui */
  fontFamily?: string;
  /** Monospace font family for code. Default: monospace */
  fontFamilyMono?: string;
  /** Max width for content area (e.g. "700px"). Unset = full width. */
  contentMaxWidth?: string;
}

export const lightTheme: NexusTheme = {
  bg: "#ffffff",
  bgSubtle: "#f6f8fa",
  bgMuted: "#f0f0f0",
  text: "#24292e",
  textMuted: "#888888",
  textFaint: "#bbbbbb",
  border: "#eeeeee",
  borderSubtle: "#dddddd",
  accent: "#0969da",
  tooltipBg: "#333333",
  tooltipText: "#ffffff",
  hlKeyword: "#d73a49",
  hlString: "#032f62",
  hlTitle: "#6f42c1",
  hlComment: "#6a737d",
  hlNumber: "#005cc5",
  hlType: "#e36209",
  hlDeletion: "#b31d28",
  hlVariable: "#24292e",
};

export const darkTheme: NexusTheme = {
  bg: "#1e1e1e",
  bgSubtle: "#2d2d2d",
  bgMuted: "#3c3c3c",
  text: "#d4d4d4",
  textMuted: "#858585",
  textFaint: "#5a5a5a",
  border: "#333333",
  borderSubtle: "#454545",
  accent: "#4fc1ff",
  tooltipBg: "#252526",
  tooltipText: "#cccccc",
  hlKeyword: "#569cd6",
  hlString: "#ce9178",
  hlTitle: "#dcdcaa",
  hlComment: "#6a9955",
  hlNumber: "#b5cea8",
  hlType: "#4ec9b0",
  hlDeletion: "#f44747",
  hlVariable: "#9cdcfe",
};

/** Maps color tokens to CSS custom properties. Non-color tokens (fontSize etc.) are handled separately. */
const VAR_MAP: Partial<Record<keyof NexusTheme, string>> = {
  bg: "--nexus-bg",
  bgSubtle: "--nexus-bg-subtle",
  bgMuted: "--nexus-bg-muted",
  text: "--nexus-text",
  textMuted: "--nexus-text-muted",
  textFaint: "--nexus-text-faint",
  border: "--nexus-border",
  borderSubtle: "--nexus-border-subtle",
  accent: "--nexus-accent",
  tooltipBg: "--nexus-tooltip-bg",
  tooltipText: "--nexus-tooltip-text",
  hlKeyword: "--nexus-hl-keyword",
  hlString: "--nexus-hl-string",
  hlTitle: "--nexus-hl-title",
  hlComment: "--nexus-hl-comment",
  hlNumber: "--nexus-hl-number",
  hlType: "--nexus-hl-type",
  hlDeletion: "--nexus-hl-deletion",
  hlVariable: "--nexus-hl-variable",
};

function themeToEditorTheme(theme: NexusTheme): Extension {
  const vars: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(VAR_MAP)) {
    vars[cssVar] = theme[key as keyof NexusTheme] as string;
  }

  const fontSize = `${theme.fontSize ?? 15}px`;
  const fontFamily = theme.fontFamily ?? "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  const fontFamilyMono =
    theme.fontFamilyMono ?? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const contentMaxWidth = theme.contentMaxWidth;

  const contentStyles: Record<string, string> = { padding: "16px 0" };
  if (contentMaxWidth) {
    contentStyles.maxWidth = contentMaxWidth;
    contentStyles.marginLeft = "auto";
    contentStyles.marginRight = "auto";
  }

  return EditorView.theme({
    "&": {
      backgroundColor: "var(--nexus-bg)",
      color: "var(--nexus-text)",
      fontSize,
      fontFamily,
      ...vars,
    },
    ".cm-content": contentStyles,
    ".cm-line": { padding: "0 20px" },
    ".cm-gutters": {
      borderRight: "1px solid var(--nexus-border)",
      background: "var(--nexus-bg-subtle)",
      fontFamily: fontFamilyMono,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 12px",
      minWidth: "32px",
      color: "var(--nexus-text-faint)",
      fontSize: "13px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      color: "var(--nexus-text-faint)",
    },
    "& .cm-content code, & .cm-content pre": {
      fontFamily: fontFamilyMono,
    },
  });
}

/** Compartment for runtime theme switching */
const themeCompartment = new Compartment();

/** Create the theme extension. Returns [extension, reconfigure function]. */
export function createThemeExtension(theme: NexusTheme): {
  extension: Extension;
  reconfigure: (next: NexusTheme) => { effects: any };
} {
  const ext = themeCompartment.of(themeToEditorTheme(theme));
  return {
    extension: ext,
    reconfigure(next: NexusTheme) {
      return { effects: themeCompartment.reconfigure(themeToEditorTheme(next)) };
    },
  };
}
