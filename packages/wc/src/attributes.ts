import type { EditorConfig } from "@floatboat/nexus-core";

/** The `EditorConfig` subset that scalar HTML attributes can express. */
export type AttributeConfig = Partial<
  Pick<
    EditorConfig,
    | "readOnly"
    | "direction"
    | "tabSize"
    | "indentGuides"
    | "parseDelayMs"
    | "slashMenuLimit"
    | "livePreview"
    | "multiCursor"
  >
>;

function readBoolean(el: HTMLElement, name: string): true | undefined {
  return el.hasAttribute(name) ? true : undefined;
}

/**
 * Non-negative integers only — a malformed attribute falls back to the core
 * default instead of forwarding `NaN` (or a nonsense negative) into
 * `createEditor`.
 */
function readNonNegativeInt(el: HTMLElement, name: string): number | undefined {
  const raw = el.getAttribute(name);
  if (raw === null) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readDirection(el: HTMLElement): "ltr" | "rtl" | undefined {
  const raw = el.getAttribute("direction");
  return raw === "ltr" || raw === "rtl" ? raw : undefined;
}

/**
 * Unset (or invalid) attributes are omitted entirely so `createEditor`'s
 * own defaults stay in charge.
 */
export function readAttributeConfig(el: HTMLElement): AttributeConfig {
  const config: AttributeConfig = {};

  const readOnly = readBoolean(el, "readonly");
  if (readOnly !== undefined) config.readOnly = readOnly;

  const direction = readDirection(el);
  if (direction !== undefined) config.direction = direction;

  const tabSize = readNonNegativeInt(el, "tab-size");
  if (tabSize !== undefined) config.tabSize = tabSize;

  const indentGuides = readBoolean(el, "indent-guides");
  if (indentGuides !== undefined) config.indentGuides = indentGuides;

  const parseDelayMs = readNonNegativeInt(el, "parse-delay-ms");
  if (parseDelayMs !== undefined) config.parseDelayMs = parseDelayMs;

  const slashMenuLimit = readNonNegativeInt(el, "slash-menu-limit");
  if (slashMenuLimit !== undefined) config.slashMenuLimit = slashMenuLimit;

  const livePreview = readBoolean(el, "live-preview");
  if (livePreview !== undefined) config.livePreview = livePreview;

  const multiCursor = readBoolean(el, "multi-cursor");
  if (multiCursor !== undefined) config.multiCursor = multiCursor;

  return config;
}
