const { createRequire } = await import("node:module");
const native = createRequire(import.meta.url)("./build/Release/foundation_models.node");
const availability = await native.getAvailability();
if (typeof availability.available !== "boolean") throw new Error("bad availability");
if ((await native.suggest("A short paragraph.")) !== null && availability.available === false) {
  throw new Error("unavailable model returned a suggestion");
}
native.dispose();
