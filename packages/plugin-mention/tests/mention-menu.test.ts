import { describe, expect, it } from "vitest";
import { createMentionMenu, updateMenuSelection } from "../src/mention-menu";
import type { MentionItem } from "../src/mention-types";

describe("createMentionMenu", () => {
  const items: MentionItem[] = [
    { id: "1", name: "Alice", avatar: "https://example.com/a.png", description: "Engineer" },
    { id: "2", name: "Bob" },
    { id: "3", name: "Charlie", description: "Designer" },
  ];

  it("creates a root with listbox role", () => {
    const { root } = createMentionMenu(items, 0);
    expect(root.getAttribute("role")).toBe("listbox");
    expect(root.dataset.testId).toBe("mention-menu");
  });

  it("renders items with correct ARIA selected state", () => {
    const { items: lis } = createMentionMenu(items, 1);
    expect(lis).toHaveLength(3);
    expect(lis[0].getAttribute("aria-selected")).toBe("false");
    expect(lis[1].getAttribute("aria-selected")).toBe("true");
    expect(lis[1].classList.contains("nexus-mention-item-selected")).toBe(true);
  });

  it("renders empty state when no items", () => {
    const { root, items: lis } = createMentionMenu([], 0);
    expect(lis).toHaveLength(1);
    expect(lis[0].textContent).toBe("No results");
    expect(lis[0].getAttribute("aria-disabled")).toBe("true");
  });

  it("uses custom renderItem when provided", () => {
    const custom = (item: MentionItem, selected: boolean) =>
      `<span class="custom" data-sel="${selected}">${item.name}</span>`;
    const { items: lis } = createMentionMenu(items, 0, custom);
    expect(lis[0].innerHTML).toContain('class="custom"');
    expect(lis[0].innerHTML).toContain("Alice");
  });
});

describe("updateMenuSelection", () => {
  it("updates selection and aria-activedescendant", () => {
    const items: MentionItem[] = [{ id: "1", name: "A" }, { id: "2", name: "B" }];
    const menu = createMentionMenu(items, 0);
    updateMenuSelection(menu, 1, items);
    expect(menu.items[0].classList.contains("nexus-mention-item-selected")).toBe(false);
    expect(menu.items[1].classList.contains("nexus-mention-item-selected")).toBe(true);
    expect(menu.root.getAttribute("aria-activedescendant")).toBe(menu.items[1].id);
  });
});
