const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

export function imageFileToDataUrl(file: File): Promise<string> {
  if (!INLINE_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return Promise.reject(new Error(`Unsupported pasted image type: ${file.type || "unknown"}`));
  }
  if (file.size === 0) return Promise.reject(new Error("Pasted image is empty"));
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    return Promise.reject(new Error("Pasted image exceeds the 20 MB limit"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not encode pasted image"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read image")));
    reader.readAsDataURL(file);
  });
}
