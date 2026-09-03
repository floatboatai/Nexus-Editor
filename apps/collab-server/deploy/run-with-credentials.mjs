import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const credentialDirectory = process.env.CREDENTIALS_DIRECTORY;
  if (!credentialDirectory || !isAbsolute(credentialDirectory)) {
    throw new Error("Missing systemd credential directory");
  }
  const secret = readFileSync(join(credentialDirectory, "auth-secret"), "utf8").trim();
  if (Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 4_096) {
    throw new Error("Invalid signing credential length");
  }
  process.env.NEXUS_COLLAB_AUTH_SECRET = secret;
  const cliUrl = new URL("../dist/cli.js", import.meta.url);
  // Retain the CLI's entry-point guard without a child process that could miss SIGTERM.
  process.argv = [process.execPath, fileURLToPath(cliUrl), ...process.argv.slice(2)];
  await import(cliUrl.href);
} catch {
  process.stderr.write("Nexus deployment startup failed: check credential and release installation.\n");
  process.exitCode = 1;
}
