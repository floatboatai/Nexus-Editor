import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";

const setExternalDocumentModeEffect = StateEffect.define<boolean>();

const externalDocumentModeField = StateField.define<boolean>({
  create: () => false,
  update(active, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setExternalDocumentModeEffect)) active = effect.value;
    }
    return active;
  },
});

/** Internal state used by widgets that must not own document text while an external model is active. */
export const externalDocumentModeExtension: Extension = externalDocumentModeField;

export function isExternalDocumentModeActive(state: EditorState): boolean {
  return state.field(externalDocumentModeField, false) === true;
}

export function externalDocumentModeTransaction(state: EditorState, active: boolean) {
  return state.update({
    effects: setExternalDocumentModeEffect.of(active),
    filter: false,
  });
}
