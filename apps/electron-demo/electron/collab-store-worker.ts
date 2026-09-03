import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createReplicaStoreRequestBroker } from "./collab-store-request-broker";
import { mainMessagePortChannel } from "./collab-store-message-port";
import { createSqliteReplicaStore } from "./collab-sqlite-store";

const DATABASE_ARGUMENT = "--nexus-collab-database=";

function databasePathFromArguments(argv: readonly string[]): string {
  const argument = argv.find((value) => value.startsWith(DATABASE_ARGUMENT));
  const databasePath = argument?.slice(DATABASE_ARGUMENT.length) ?? "";
  if (
    !databasePath ||
    databasePath.length > 4_096 ||
    !path.isAbsolute(databasePath) ||
    /[\u0000\r\n]/u.test(databasePath)
  ) {
    throw new Error("Collaboration persistence database path is invalid");
  }
  return databasePath;
}

function exactMessage(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function run(): Promise<void> {
  const parentPort = process.parentPort;
  if (!parentPort) {
    throw new Error("Collaboration persistence worker requires an Electron utility parent port");
  }
  const databasePath = databasePathFromArguments(process.argv);
  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const store = await createSqliteReplicaStore({ databasePath });
  const broker = createReplicaStoreRequestBroker(store);
  let closing = false;

  parentPort.on("message", (event) => {
    const message: unknown = event.data;
    if (exactMessage(message, ["type", "rendererId", "generation"]) && message.type === "connect") {
      if (
        closing ||
        !Number.isSafeInteger(message.rendererId) ||
        (message.rendererId as number) <= 0 ||
        !Number.isSafeInteger(message.generation) ||
        (message.generation as number) <= 0 ||
        event.ports.length !== 1
      ) {
        event.ports.forEach((port) => port.close());
        return;
      }
      broker.connect(mainMessagePortChannel(event.ports[0]));
      return;
    }
    if (exactMessage(message, ["type"]) && message.type === "shutdown" && !closing) {
      closing = true;
      void broker.close().then(() => {
        parentPort.postMessage({ type: "closed", ok: true });
        setImmediate(() => process.exit(0));
      }).catch(() => {
        parentPort.postMessage({ type: "closed", ok: false, code: "store-cleanup-failed" });
        setImmediate(() => process.exit(1));
      });
    }
  });

  parentPort.postMessage({ type: "ready" });
}

void run().catch(() => {
  // Do not include the path, SQLite cause, or environment in diagnostics sent
  // across the process boundary.
  process.parentPort?.postMessage({ type: "failed", code: "sqlite-init-failed" });
  setImmediate(() => process.exit(1));
});
