import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import electronPackage from "../package.json";

describe("Electron demo native build packaging", () => {
  it("defines a native build script and preserves its output after tsup clean", () => {
    expect(electronPackage.scripts["native:build"]).toBe("native/foundation-models/build.sh");
    expect(electronPackage.scripts.build).toContain("pnpm run native:build");
    expect(electronPackage.scripts.build.indexOf("--clean")).toBeLessThan(
      electronPackage.scripts.build.indexOf("pnpm run native:build")
    );
    expect(electronPackage.scripts.build.indexOf("pnpm run native:build")).toBeLessThan(
      electronPackage.scripts.build.indexOf("vite build")
    );
  });

  it("keeps the copied native addon inside packaged dist-electron files", () => {
    expect(electronPackage.build.files).toContain("dist-electron/**/*");

    const buildScript = readFileSync("apps/electron-demo/native/foundation-models/build.sh", "utf8");
    expect(buildScript).toContain("../../dist-electron/native");
    expect(buildScript).toContain("foundation_models.node");
  });

  it("no-ops successfully on non-darwin hosts without touching existing native output", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "nexus-fm-build-"));
    const fakeUname = join(fakeBin, "uname");
    writeFileSync(fakeUname, "#!/bin/sh\nif [ \"$1\" = \"-s\" ]; then echo Linux; else /usr/bin/uname \"$@\"; fi\n");
    chmodSync(fakeUname, 0o755);

    const packaged = "apps/electron-demo/dist-electron/native/foundation_models.node";
    const local = "apps/electron-demo/native/foundation-models/build/Release/foundation_models.node";
    const before = [packaged, local].map((path) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return null;
      }
    });

    const output = execFileSync("bash", ["apps/electron-demo/native/foundation-models/build.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    const after = [packaged, local].map((path) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return null;
      }
    });

    expect(output).toContain("Skipping Foundation Models addon build: non-darwin host.");
    expect(after).toEqual(before);
  });
});
