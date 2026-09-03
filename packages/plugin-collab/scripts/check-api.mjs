import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const entries = ["index", "assessment", "hocuspocus-provider", "indexeddb-store"];
const packagePath = new URL("../package.json", import.meta.url);
const snapshotPath = new URL("../api/public-exports.json", import.meta.url);

async function readUtf8(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing ${fileURLToPath(path)}. Run the package build before check:api.`);
    }
    throw error;
  }
}

function collectExports(declaration) {
  const names = new Set();
  for (const match of declaration.matchAll(/export\s*\{([\s\S]*?)\}\s*(?:from\s*['"][^'"]+['"])?\s*;/g)) {
    for (const raw of match[1].split(",")) {
      const specifier = raw.trim().replace(/^type\s+/, "");
      if (!specifier) continue;
      names.add(specifier.match(/\s+as\s+([^\s]+)$/)?.[1] ?? specifier.split(/\s+/)[0]);
    }
  }
  for (const match of declaration.matchAll(/export\s+(?:declare\s+)?(?:class|interface|type|const|function)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function collectModuleSpecifiers(declaration) {
  return [...declaration.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
}

const writeSnapshot = process.argv.includes("--write");
const packageJson = JSON.parse(await readUtf8(packagePath));
const allowedModules = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
]);
const actual = {};

const declarationFiles = (await readdir(new URL("../dist/", import.meta.url)))
  .filter((name) => name.endsWith(".d.ts"));
for (const file of declarationFiles) {
  const declaration = await readUtf8(new URL(`../dist/${file}`, import.meta.url));
  if (/\b(?:NodeJS|Electron)\s*\.|\b(?:Buffer|BufferEncoding)(?:<|\b)|node:|\bimport\s*\(\s*['"](?:electron|node:)/.test(declaration)) {
    throw new Error(`${file} leaks Node.js or Electron types.`);
  }
  if (/(?:\bfrom\s*|\bimport\s*\()\s*['"](?:yjs|y-protocols(?:\/[^'"]*)?)['"]|\bY\.(?:Doc|Text|Map|UndoManager)\b|\bAwareness\b/.test(declaration)) {
    throw new Error(`${file} leaks raw Yjs or Awareness types through the public API.`);
  }
}

for (const entry of entries) {
  const declaration = await readUtf8(new URL(`../dist/${entry}.d.ts`, import.meta.url));
  const runtime = await readUtf8(new URL(`../dist/${entry}.js`, import.meta.url));
  actual[entry] = collectExports(declaration);
  const forbiddenModules = collectModuleSpecifiers(declaration).filter((specifier) =>
    !specifier.startsWith(".") && !allowedModules.has(specifier));
  if (forbiddenModules.length > 0) {
    throw new Error(`${entry} declarations contain undeclared modules: ${forbiddenModules.join(", ")}`);
  }
  if (/\b(?:NodeJS|Electron)\s*\.|\b(?:Buffer|BufferEncoding)(?:<|\b)|node:|\bimport\s*\(\s*['"](?:electron|node:)/.test(declaration)) {
    throw new Error(`${entry} declarations leak Node.js or Electron types.`);
  }
  if (/\brequire\s*\(\s*['"]|\bprocess\s*(?:\.|\[)|\bglobalThis\s*\.\s*process\b|\bBuffer\b|(?:from\s*|import\s*\()\s*['"]node:|from\s*['"](?:electron|fs|path|child_process)['"]/.test(runtime)) {
    throw new Error(`${entry} browser bundle contains Node.js or Electron references.`);
  }
}

if (writeSnapshot) {
  await writeFile(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  console.log(`Updated ${fileURLToPath(snapshotPath)}.`);
} else {
  const expected = JSON.parse(await readUtf8(snapshotPath));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Public API snapshot changed.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}
