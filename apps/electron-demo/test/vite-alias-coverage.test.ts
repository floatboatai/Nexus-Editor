import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "../../..");

/**
 * Vite resolves `@floatboat/*` workspace packages to their TypeScript sources
 * through the `resolve.alias` map in vite.config.ts. If a package imported by
 * the demo (directly or transitively) is missing from that map, `pnpm
 * dev:electron-demo` fails with "Failed to resolve entry for package ..."
 * because the package's `exports` point at unbuilt `dist/` artifacts.
 *
 * This test guards against exactly that: it walks every package source
 * directory reachable through the alias map (plus the demo's own source) and
 * asserts the alias map covers every `@floatboat/*` import it finds.
 */
function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTsFiles(full, acc);
    } else if (entry.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function extractFloatImports(files: string[]): Set<string> {
  const packages = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/["'](@floatboat\/[^"']+)["']/g)) {
      packages.add(match[1]);
    }
  }
  return packages;
}

describe("vite alias coverage", () => {
  it("aliases every @floatboat package imported by the demo dependency graph", () => {
    const viteConfig = readFileSync(
      join(repoRoot, "apps/electron-demo/vite.config.ts"),
      "utf8"
    );

    // Alias keys are the only @floatboat strings in the config.
    const aliased = new Set<string>();
    for (const match of viteConfig.matchAll(/["'](@floatboat\/[^"']+)["']/g)) {
      aliased.add(match[1]);
    }

    // Walk the source of every aliased package plus the demo's own source.
    const scanDirs = [join(repoRoot, "apps/electron-demo/src")];
    for (const match of viteConfig.matchAll(/"\.\.\/\.\.\/packages\/([^/]+)\/src"/g)) {
      scanDirs.push(join(repoRoot, "packages", match[1], "src"));
    }

    const imported = extractFloatImports(scanDirs.flatMap((dir) => collectTsFiles(dir)));
    const missing = [...imported]
      .filter((pkg) => !aliased.has(pkg))
      .sort();

    expect(missing).toEqual([]);
  });
});
