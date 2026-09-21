/**
 * Toolbar icon factories.
 * Text-based icons (B, I, S, etc.) use plain HTML spans for reliable rendering.
 * Pictographic icons use inline SVG with stroke paths.
 */

const SVG_SIZE = 18;

// --- helpers ---

function svgIcon(paths: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:flex;align-items:center;justify-content:center;width:18px;height:18px;";
  wrap.innerHTML =
    `<svg width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    paths + `</svg>`;
  return wrap;
}

function textLabel(text: string, extra = ""): HTMLElement {
  const span = document.createElement("span");
  span.textContent = text;
  span.style.cssText = `font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;line-height:1;${extra}`;
  return span;
}

// --- exports ---

export function iconUndo(): HTMLElement {
  return svgIcon(
    `<path d="M4 7h8a4 4 0 0 1 0 8H11"/>` +
    `<polyline points="7 4 4 7 7 10"/>`
  );
}

export function iconRedo(): HTMLElement {
  return svgIcon(
    `<path d="M14 7H6a4 4 0 0 0 0 8h1"/>` +
    `<polyline points="11 4 14 7 11 10"/>`
  );
}

export function iconLink(): HTMLElement {
  // Two interlocking hooks on a diagonal chain. Drawn upright and rotated so
  // the geometry stays readable: each hook is a straight run into a
  // half-circle cap and a straight run back, and the two hooks stop short of
  // each other on opposite edges — that offset pair of gaps is what reads as
  // "linked" rather than as one outlined capsule.
  // Gaps are sized against the 1.8 stroke: a round cap adds 0.9 past each end,
  // so a 3.0 separation is what leaves a ~1.2 gap on screen. Tighter than that
  // and the two hooks merge into one outlined capsule.
  return svgIcon(
    `<g transform="rotate(-45 9 9)">` +
      `<path d="M10.2 6.5H11.5a2.5 2.5 0 0 1 0 5H10.8"/>` +
      `<path d="M7.8 11.5H6.5a2.5 2.5 0 0 1 0-5H7.2"/>` +
      `</g>`
  );
}

export function iconH2(): HTMLElement {
  return textLabel("H2", "font-size:12px;");
}

export function iconH3(): HTMLElement {
  return textLabel("H3", "font-size:12px;");
}

export function iconHeadingMenu(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex;align-items:baseline;gap:2px;font-family:system-ui,-apple-system,sans-serif;";
  const t = document.createElement("span");
  t.textContent = "Hn";
  t.style.cssText = "font-size:11px;font-weight:600;line-height:1;";
  const dot = document.createElement("span");
  dot.style.cssText = "width:3px;height:3px;border-radius:50%;background:currentColor;flex-shrink:0;margin-bottom:1px;";
  wrap.append(t, dot);
  return wrap;
}

export function iconBold(): HTMLElement {
  return textLabel("B");
}

export function iconItalic(): HTMLElement {
  return textLabel("I", "font-style:italic;");
}

export function iconStrikethrough(): HTMLElement {
  return textLabel("S", "text-decoration:line-through;");
}

export function iconUnderline(): HTMLElement {
  return textLabel("U", "text-decoration:underline;text-underline-offset:2px;");
}

export function iconInlineCode(): HTMLElement {
  return svgIcon(
    `<polyline points="6 5 2 9 6 13"/>` +
    `<polyline points="12 5 16 9 12 13"/>`
  );
}

export function iconBlockquote(): HTMLElement {
  return svgIcon(
    `<path d="M3 6h4l-1 4H4a2 2 0 0 1 2 2" fill="none"/>` +
    `<path d="M11 6h4l-1 4h-2a2 2 0 0 1 2 2" fill="none"/>`
  );
}

export function iconCodeBlock(): HTMLElement {
  return svgIcon(
    `<rect x="2" y="2" width="14" height="14" rx="2"/>` +
    `<polyline points="6 6 4 9 6 12"/>` +
    `<polyline points="12 6 14 9 12 12"/>`
  );
}

export function iconOrderedList(): HTMLElement {
  return svgIcon(
    `<line x1="8" y1="4" x2="16" y2="4"/>` +
    `<line x1="8" y1="9" x2="16" y2="9"/>` +
    `<line x1="8" y1="14" x2="16" y2="14"/>` +
    `<text x="3.5" y="6" fill="currentColor" stroke="none" font-size="6" font-family="system-ui" text-anchor="middle">1</text>` +
    `<text x="3.5" y="11" fill="currentColor" stroke="none" font-size="6" font-family="system-ui" text-anchor="middle">2</text>` +
    `<text x="3.5" y="16" fill="currentColor" stroke="none" font-size="6" font-family="system-ui" text-anchor="middle">3</text>`
  );
}

export function iconUnorderedList(): HTMLElement {
  return svgIcon(
    `<line x1="8" y1="4" x2="16" y2="4"/>` +
    `<line x1="8" y1="9" x2="16" y2="9"/>` +
    `<line x1="8" y1="14" x2="16" y2="14"/>` +
    `<circle cx="3.5" cy="4" r="1.5" fill="currentColor" stroke="none"/>` +
    `<circle cx="3.5" cy="9" r="1.5" fill="currentColor" stroke="none"/>` +
    `<circle cx="3.5" cy="14" r="1.5" fill="currentColor" stroke="none"/>`
  );
}

export function iconTextColor(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex;flex-direction:column;align-items:center;gap:1px;";
  const a = document.createElement("span");
  a.textContent = "A";
  a.style.cssText = "font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;line-height:1;";
  const bar = document.createElement("span");
  bar.style.cssText = "width:12px;height:2px;border-radius:1px;background:var(--nexus-accent,#0969da);";
  wrap.append(a, bar);
  return wrap;
}

export function iconHighlight(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;position:relative;";
  const bg = document.createElement("span");
  bg.style.cssText = "position:absolute;inset:2px;border-radius:2px;background:var(--nexus-accent,#0969da);opacity:0.15;";
  const a = document.createElement("span");
  a.textContent = "A";
  a.style.cssText = "position:relative;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;line-height:1;";
  wrap.append(bg, a);
  return wrap;
}

export function iconImage(): HTMLElement {
  return svgIcon(
    `<rect x="2" y="3" width="14" height="12" rx="2"/>` +
    `<circle cx="6" cy="7" r="1.5" fill="currentColor" stroke="none"/>` +
    `<path d="M2 12l4-4 3 3 2-2 5 5" fill="none" stroke-width="1.5"/>`
  );
}

export function iconFullscreen(): HTMLElement {
  return svgIcon(
    `<polyline points="4 7 4 4 7 4"/>` +
    `<polyline points="14 7 14 4 11 4"/>` +
    `<polyline points="4 11 4 14 7 14"/>` +
    `<polyline points="14 11 14 14 11 14"/>`
  );
}

export function iconHorizontalRule(): HTMLElement {
  return svgIcon(
    `<line x1="2" y1="9" x2="16" y2="9"/>`
  );
}

export function iconTable(): HTMLElement {
  return svgIcon(
    `<rect x="2" y="3" width="14" height="12" rx="2"/>` +
    `<line x1="2" y1="7" x2="16" y2="7"/>` +
    `<line x1="7" y1="7" x2="7" y2="15"/>` +
    `<line x1="11.5" y1="7" x2="11.5" y2="15"/>` +
    `<line x1="2" y1="11" x2="16" y2="11"/>`
  );
}

export function iconEmoji(): HTMLElement {
  return svgIcon(
    `<circle cx="9" cy="9" r="6.5"/>` +
    `<circle cx="6.8" cy="7.4" r="0.5" fill="currentColor" stroke="none"/>` +
    `<circle cx="11.2" cy="7.4" r="0.5" fill="currentColor" stroke="none"/>` +
    `<path d="M6.3 10.6a3.3 3.3 0 0 0 5.4 0"/>`
  );
}
