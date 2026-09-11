import remarkGfm from "remark-gfm";
import type { DocumentRenderExtension } from "./types";

export function createGfmRenderExtension(): DocumentRenderExtension {
  return { remarkPlugins: [remarkGfm] };
}
