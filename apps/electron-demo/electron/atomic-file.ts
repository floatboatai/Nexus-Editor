import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function temporaryPath(target: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
}

export async function atomicWriteFile(target: string, data: string | Uint8Array): Promise<void> {
  const temporary = temporaryPath(target);
  try {
    await writeFile(temporary, data);
    await rename(temporary, target);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      // Preserve the original write or rename error.
    }
    throw error;
  }
}
