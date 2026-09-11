import type { AssetProvider, ConversionResult } from "./types";
import { checkBytes, throwIfAborted } from "./limits";

export function createConversionAssetProvider(result: ConversionResult, fallback?: AssetProvider): AssetProvider {
  const assets = new Map(result.assetPlan.map((entry) => [entry.source, entry.resource]));
  return Object.freeze({
    async read(source, options) {
      throwIfAborted(options?.signal);
      if (!assets.has(source)) return fallback?.read(source, options) ?? null;
      const resource = assets.get(source);
      if (!resource) return null;
      if (options?.maxBytes !== undefined) checkBytes(resource.bytes, options.maxBytes, "Asset");
      return { bytes: resource.bytes.slice(), mimeType: resource.mimeType };
    },
  } satisfies AssetProvider);
}
