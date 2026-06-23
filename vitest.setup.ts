/**
 * jsdom does not implement `Range.getClientRects` / `getBoundingClientRect`,
 * which CodeMirror's drawSelection layer (enabled by `multiCursor: true`)
 * calls during its measure cycle. CodeMirror catches the resulting
 * TypeError, but logs it — flooding stderr on every test run that creates a
 * multi-cursor editor. Stub them with empty geometry: layer rendering is a
 * no-op headless, selection *state* (what tests assert on) is unaffected.
 */
const emptyRectList = (): DOMRectList => {
  const list = [] as unknown as DOMRectList;
  (list as unknown as { item: (index: number) => DOMRect | null }).item = () => null;
  return list;
};

if (typeof Range !== "undefined") {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = emptyRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  }
}
