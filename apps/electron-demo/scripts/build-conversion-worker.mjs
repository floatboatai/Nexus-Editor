import { fileURLToPath } from "node:url";
import { buildBrowserWorker } from "../../../packages/document/scripts/build-browser-worker.mjs";

export async function prepareConversionWorker() {
  const output = fileURLToPath(new URL("../../../packages/document/dist", import.meta.url));
  await buildBrowserWorker(output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepareConversionWorker();
}
