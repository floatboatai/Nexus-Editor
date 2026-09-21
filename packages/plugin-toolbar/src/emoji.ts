/**
 * Curated emoji set for the toolbar picker.
 *
 * Deliberately a fixed list rather than a full Unicode emoji dataset: a
 * complete table is a large runtime asset, and pulling one in would add a
 * dependency the project would have to licence-review. These cover the
 * reactions that actually show up in notes and documents.
 */
export interface EmojiCategory {
  id: string;
  label: string;
  emoji: readonly string[];
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: "faces",
    label: "Faces",
    emoji: ["😀", "😄", "😁", "😂", "😊", "🙂", "😉", "😍", "🤔", "😅", "😢", "😡", "😴", "🤯", "🥳", "😎"],
  },
  {
    id: "gestures",
    label: "Gestures",
    emoji: ["👍", "👎", "👌", "✌", "🙏", "👏", "🙌", "🤝", "💪", "✋"],
  },
  {
    id: "symbols",
    label: "Symbols",
    emoji: ["✅", "❌", "⚠", "❗", "❓", "💡", "🔥", "⭐", "🎉", "📌", "⏰", "🔒"],
  },
  {
    id: "objects",
    label: "Objects",
    emoji: ["📝", "📄", "📁", "📂", "📎", "🔗", "📊", "📈", "📉", "📅", "📷", "🎯"],
  },
];
