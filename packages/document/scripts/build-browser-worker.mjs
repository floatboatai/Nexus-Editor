import { build } from "tsup";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export async function buildBrowserWorker(outDir) {
  await build({
    config: false,
    entry: {
      "browser-worker": `${packageRoot}/src/browser-worker.ts`,
      "worker-browser": `${packageRoot}/src/worker-browser.ts`,
    },
    outDir,
    format: ["esm"],
    outExtension: () => ({ js: ".js" }),
    platform: "browser",
    target: "es2022",
    splitting: false,
    dts: false,
    clean: false,
    silent: true,
    noExternal: [/.*/],
    tsconfig: `${packageRoot}/tsconfig.json`,
    esbuildOptions(options) {
      // The package's browser export creates a DOM element at module evaluation.
      // Resolve its pure data-table implementation for the dedicated Worker only.
      options.alias = { "decode-named-character-reference": require.resolve("decode-named-character-reference") };
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildBrowserWorker(`${packageRoot}/dist`);
