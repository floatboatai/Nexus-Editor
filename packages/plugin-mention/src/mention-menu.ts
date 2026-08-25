/**
 * Floating mention menu DOM builder. Headless + ARIA.
 */

import type { MentionItem, MentionRenderItemFn } from "./mention-types";

export interface MentionMenuElements {
  root: HTMLDivElement;
  list: HTMLUListElement;
  items: HTMLLIElement[];
}

let menuIdCounter = 0;
let itemIdCounter = 0;

function defaultRenderItem(item: MentionItem, selected: boolean): HTMLElement {
  const li = document.createElement("li");
  li.className = "nexus-mention-item";
  if (selected) li.classList.add("nexus-mention-item-selected");
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", String(selected));

  const inner = document.createElement("div");
  inner.className = "nexus-mention-item-inner";

  if (item.avatar) {
    const img = document.createElement("img");
    img.src = item.avatar;
    img.alt = "";
    img.className = "nexus-mention-item-avatar";
    inner.appendChild(img);
  }

  const textWrap = document.createElement("div");
  textWrap.className = "nexus-mention-item-text";

  const name = document.createElement("span");
  name.className = "nexus-mention-item-name";
  name.textContent = item.name;
  textWrap.appendChild(name);

  if (item.description) {
    const desc = document.createElement("span");
    desc.className = "nexus-mention-item-desc";
    desc.textContent = item.description;
    textWrap.appendChild(desc);
  }

  inner.appendChild(textWrap);
  li.appendChild(inner);
  return li;
}

export function createMentionMenu(
  items: MentionItem[],
  selectedIndex: number,
  renderItem?: MentionRenderItemFn
): MentionMenuElements {
  const root = document.createElement("div");
  root.className = "nexus-mention-menu";
  root.setAttribute("role", "listbox");
  root.dataset.testId = "mention-menu";
  const menuId = `nexus-mention-menu-${++menuIdCounter}`;
  root.id = menuId;

  const list = document.createElement("ul");
  list.className = "nexus-mention-list";
  list.setAttribute("role", "presentation");

  const itemElements: HTMLLIElement[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const selected = i === selectedIndex;
    const itemId = `${menuId}-item-${++itemIdCounter}`;

    let li: HTMLLIElement;
    if (renderItem) {
      const rendered = renderItem(item, selected);
      if (typeof rendered === "string") {
        const wrapper = document.createElement("li");
        wrapper.className = "nexus-mention-item";
        if (selected) wrapper.classList.add("nexus-mention-item-selected");
        wrapper.setAttribute("role", "option");
        wrapper.setAttribute("aria-selected", String(selected));
        wrapper.innerHTML = rendered;
        li = wrapper;
      } else {
        li = rendered as HTMLLIElement;
        if (!li.hasAttribute("role")) li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(selected));
        if (!li.id) li.id = itemId;
      }
    } else {
      li = defaultRenderItem(item, selected);
    }

    li.id = itemId;
    li.dataset.index = String(i);
    li.dataset.mentionId = item.id;
    list.appendChild(li);
    itemElements.push(li);
  }

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "nexus-mention-item nexus-mention-item-empty";
    empty.setAttribute("role", "option");
    empty.setAttribute("aria-disabled", "true");
    empty.textContent = "No results";
    list.appendChild(empty);
    itemElements.push(empty);
  }

  root.appendChild(list);
  return { root, list, items: itemElements };
}

export function updateMenuSelection(
  elements: MentionMenuElements,
  newIndex: number,
  items: MentionItem[]
): void {
  for (let i = 0; i < elements.items.length; i++) {
    const li = elements.items[i];
    const selected = i === newIndex;
    li.classList.toggle("nexus-mention-item-selected", selected);
    li.setAttribute("aria-selected", String(selected));
    if (selected) {
      elements.root.setAttribute("aria-activedescendant", li.id);
    }
  }
  const selectedEl = elements.items[newIndex];
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: "nearest" });
  }
}
