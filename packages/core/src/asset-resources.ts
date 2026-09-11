import type { AssetProvider } from "./assets";
import { StateEffect, StateField } from "@codemirror/state";

export const resetAssetContext = StateEffect.define<null>();
export const assetContextRevision = StateField.define<number>({
  create: () => 0,
  update: (revision, transaction) => transaction.effects.some((effect) => effect.is(resetAssetContext)) ? revision + 1 : revision,
});

const resources = new WeakMap<Element, () => void>();
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface AssetImageHandle {
  readonly ready: Promise<"loaded" | "unavailable" | "failed" | "cancelled">;
  dispose(): void;
}

/** No src is assigned until an explicitly supplied provider authorizes the bytes. */
export function loadAssetImage(image: HTMLImageElement, source: string, provider: AssetProvider): AssetImageHandle {
  releaseAssetResources(image);
  const abort = new AbortController();
  const urls = image.ownerDocument.defaultView?.URL;
  let url: string | null = null;
  const dispose = () => {
    abort.abort();
    if (url) urls?.revokeObjectURL(url);
    url = null;
    if (resources.get(image) === dispose) {
      image.removeAttribute("src");
      resources.delete(image);
    }
  };
  resources.set(image, dispose);
  image.removeAttribute("src");
  delete image.dataset.assetError;
  const reading = Promise.resolve().then(() => provider.read(source, { signal: abort.signal, maxBytes: MAX_IMAGE_BYTES })).then((asset) => {
    if (abort.signal.aborted) return "cancelled" as const;
    if (!asset || asset.bytes.byteLength > MAX_IMAGE_BYTES ||
      !/^image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml)$/i.test(asset.mimeType)) {
      image.dataset.assetError = "resource-unavailable";
      return "unavailable" as const;
    }
    if (!urls?.createObjectURL) {
      image.dataset.assetError = "object-url-unsupported";
      return "unavailable" as const;
    }
    const bytes = new Uint8Array(asset.bytes);
    url = urls.createObjectURL(new Blob([bytes.buffer], { type: asset.mimeType }));
    image.src = url;
    return "loaded" as const;
  }).catch(() => {
    if (abort.signal.aborted) return "cancelled" as const;
    image.dataset.assetError = "resource-failed";
    return "failed" as const;
  });
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<"cancelled">((resolve) => {
    onAbort = () => resolve("cancelled");
    abort.signal.addEventListener("abort", onAbort, { once: true });
  });
  const ready = Promise.race([reading, cancelled]).finally(() => abort.signal.removeEventListener("abort", onAbort));
  return { ready, dispose };
}

export function releaseAssetResources(root: Element): void {
  for (const element of [root, ...Array.from(root.querySelectorAll("img"))]) {
    resources.get(element)?.();
    resources.delete(element);
  }
}
