/** Internal demo policies shared by the renderer and main-process adapters. */
export const PUBLIC_DOCUMENT_HISTORY_POLICY = Object.freeze({
  maxDocuments: 1,
  maxVersionsPerDocument: 100,
  maxBytesPerDocument: 32 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
});

export const PUBLIC_DOCUMENT_SEARCH_MAX_BYTES = 2 * 1024 * 1024;
