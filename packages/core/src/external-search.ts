import { StateEffect, StateField } from "@codemirror/state";

/**
 * Effect dispatched by `EditorAPI.setSearchQuery` to drive live-preview search
 * highlighting (e.g. table cells) from a host's own search UI, without opening
 * the CodeMirror search panel. An empty string clears the query.
 *
 * Kept in core (rather than the search plugin) so hosts can set the query
 * through the public `EditorAPI` without core depending on `@codemirror/search`.
 */
export const setExternalSearchQuery = StateEffect.define<string>();

/**
 * The currently active host-provided search query. Empty string means "no
 * active search". The search plugin's table highlighter reads this field when
 * the CodeMirror search panel is closed, so table matches still highlight when
 * a host drives search with its own toolbar.
 */
export const externalSearchQueryField = StateField.define<string>({
  create() {
    return "";
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setExternalSearchQuery)) {
        return effect.value;
      }
    }
    return value;
  }
});
