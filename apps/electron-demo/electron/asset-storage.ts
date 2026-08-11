import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

export interface PastedImageData {
  name: string;
  type: string;
  data: Uint8Array;
}

export interface SavedPastedImage {
  path: string;
  url: string;
}

function assertInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Image path escapes vault");
  }
  return resolvedTarget;
}

function sanitizeStem(fileName: string): string {
  const rawStem = path.basename(fileName, path.extname(fileName));
  const stem = rawStem
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  const fallback = (stem || "pasted-image").slice(0, 80).replace(/[. ]+$/g, "");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(fallback) ? `_${fallback}` : fallback;
}

function encodeMarkdownPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) =>
      segment === ".." || segment === "."
        ? segment
        : encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
            `%${char.charCodeAt(0).toString(16).toUpperCase()}`
          )
    )
    .join("/");
}

export async function savePastedImage(
  vaultRoot: string,
  sourcePath: string,
  image: PastedImageData
): Promise<SavedPastedImage> {
  const mime = image.type.toLowerCase().split(";", 1)[0].trim();
  const extension = IMAGE_EXTENSIONS[mime];
  if (!extension) throw new Error(`Unsupported pasted image type: ${image.type || "unknown"}`);
  if (!(image.data instanceof Uint8Array) || image.data.byteLength === 0) {
    throw new Error("Pasted image is empty");
  }
  if (image.data.byteLength > MAX_PASTED_IMAGE_BYTES) {
    throw new Error("Pasted image exceeds the 20 MB limit");
  }

  const root = path.resolve(vaultRoot);
  const source = assertInside(root, sourcePath);
  const attachmentDir = assertInside(root, path.join(root, "assets"));
  await mkdir(attachmentDir, { recursive: true });

  const stem = sanitizeStem(image.name);
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const fileName = `${stem}${suffix === 0 ? "" : `-${suffix}`}${extension}`;
    const destination = assertInside(root, path.join(attachmentDir, fileName));
    try {
      await writeFile(destination, image.data, { flag: "wx" });
      return {
        path: destination,
        url: encodeMarkdownPath(path.relative(path.dirname(source), destination)),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }

  throw new Error("Could not allocate a unique pasted image name");
}
