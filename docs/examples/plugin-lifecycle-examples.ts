/**
 * # Nexus Editor — Plugin Lifecycle Hooks & Event Bus API
 *
 * Usage examples for the enhanced plugin system introduced in v0.1.0.
 * Every feature shown here is fully typed via TypeScript.
 *
 * ## Table of Contents
 * 1. [Plugin Lifecycle Hooks](#1-plugin-lifecycle-hooks)
 * 2. [Event Bus (editor.on / editor.off)](#2-event-bus)
 * 3. [Dynamic Plugin Management](#3-dynamic-plugin-management)
 * 4. [Error Handling](#4-error-handling)
 *
 * ## 1. Plugin Lifecycle Hooks
 *
 * Plugins can implement any of these lifecycle hooks. They are all
 * optional — a plugin that doesn't need a hook simply omits it.
 *
 * | Hook | When | Can cancel? |
 * |---|---|---|
 * | `onEditorReady` | After editor is fully initialised | No |
 * | `onBeforeChange` | Before a change event fires | Yes (return false) |
 * | `onAfterChange` | After a change event fires | No |
 * | `onBeforeSetDocument` | Before `setDocument()` replaces content | Yes (return false) |
 * | `onSelectionChange` | On cursor / range selection change | No |
 * | `onDestroy` | During editor teardown | No |
 */

// =========================================================================
// 1. Plugin Lifecycle Hooks
// =========================================================================

import { createEditor, type EditorAPI, type NexusPlugin } from "@floatboat/nexus-core";

/*
 * A plugin with all lifecycle hooks implemented.
 */
const fullLifecyclePlugin: NexusPlugin = {
  name: "demo-lifecycle",

  // ── Initialisation ───────────────────────────────────────────────────
  // EditorAPI is fully ready. Safe to call getDocument(), on(), etc.
  onEditorReady(editor: EditorAPI) {
    const doc = editor.getDocument();
    console.log(`[demo] Editor ready with ${doc.length} characters`);

    // Subscribe to additional events
    editor.on("themeChange", (_theme) => {
      console.log("[demo] Theme changed");
    });
  },

  // ── Before change (can cancel) ───────────────────────────────────────
  // Return false to prevent the change event from being emitted to
  // external consumers (config.onChange and the "change" event).
  onBeforeChange(ctx) {
    if (ctx.doc.length > 100_000) {
      console.warn("[demo] Very large document — change suppressed");
      return false; // cancels the external change event
    }
    // Return undefined/void = proceed normally
  },

  // ── After change (notification only) ─────────────────────────────────
  onAfterChange(ctx) {
    console.log(`[demo] Document changed: ${ctx.doc.length} chars`);
  },

  // ── Before setDocument (can cancel) ──────────────────────────────────
  // Return false to prevent the replacement entirely.
  onBeforeSetDocument(ctx) {
    if (ctx.silent) return; // always allow silent loads (file open)
    if (ctx.next.length === 0) {
      console.warn("[demo] Refusing to clear document");
      return false; // cancels the replacement
    }
  },

  // ── Selection change ─────────────────────────────────────────────────
  onSelectionChange(ctx) {
    const isRange = ctx.anchor !== ctx.head;
    if (isRange) {
      console.log(`[demo] Range selected: ${ctx.anchor} → ${ctx.head}`);
    }
  },

  // ── Cleanup ──────────────────────────────────────────────────────────
  onDestroy(_editor: EditorAPI) {
    console.log("[demo] Plugin cleaned up");
  },
};

// =========================================================================
// 2. Event Bus
// =========================================================================

/*
 * The event bus supports all lifecycle events through the same
 * editor.on() / editor.off() API you already know.
 */

const editor = createEditor({
  container: document.createElement("div"),
  plugins: [fullLifecyclePlugin],
});

// ── New events ─────────────────────────────────────────────────────────

// Fires once after the editor is ready.
editor.on("editorReady", () => {
  console.log("Editor is ready");
});

// Fires on every paste event (before the default handler).
editor.on("paste", (event: ClipboardEvent) => {
  console.log(`Paste detected: ${event.clipboardData?.types.join(", ")}`);
});

// Fires on every drop event.
editor.on("drop", (event: DragEvent) => {
  console.log(`Drop detected: ${event.dataTransfer?.types.join(", ")}`);
});

// Fires on every keydown event.
editor.on("keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    console.log("Escape pressed");
  }
});

// Fires after the theme changes.
editor.on("themeChange", (theme) => {
  console.log(`Theme updated: bg=${theme.colors?.background}`);
});

// Fires before a change event is emitted (notification only — cannot cancel via event).
editor.on("beforeChange", (ctx) => {
  console.log(`About to emit change: ${ctx.doc.length} chars`);
});

// Fires before setDocument replaces content.
editor.on("beforeSetDocument", (ctx) => {
  console.log(`About to replace document (silent=${ctx.silent}): ${ctx.next.length} chars`);
});

// Fires during editor teardown (before resources are freed).
editor.on("destroy", () => {
  console.log("Editor is being destroyed");
});

// Fires on internal errors (plugin hooks that throw, etc.)
editor.on("error", (error: Error, source?: string) => {
  console.error(`Editor error from ${source}:`, error.message);
});

// ── One-shot subscription ──────────────────────────────────────────────
const onceHandler = () => {
  console.log("This fires only once");
};
editor.on("focus", onceHandler);
editor.off("focus", onceHandler); // unsubscribe before it fires

// =========================================================================
// 3. Dynamic Plugin Management
// =========================================================================

/*
 * Plugins can be added and removed at runtime without recreating the editor.
 */

// Add a plugin after editor creation.
const added = editor.addPlugin({
  name: "latecomer",
  onEditorReady(ed: EditorAPI) {
    console.log("Added late — but onEditorReady still fires immediately");
  },
  onAfterChange(ctx) {
    console.log(`Late plugin sees change: ${ctx.doc.length} chars`);
  },
});
console.log(`Plugin added: ${added}`); // true

// Query whether a plugin exists.
console.log(editor.hasPlugin("latecomer")); // true
console.log(editor.hasPlugin("nonexistent")); // false

// Remove a plugin (fires its onDestroy hook).
const removed = editor.removePlugin("latecomer");
console.log(`Plugin removed: ${removed}`); // true

// Duplicate registration is prevented.
editor.addPlugin({ name: "unique" });
editor.addPlugin({ name: "unique" }); // returns false (name collision)

// =========================================================================
// 4. Error Handling
// =========================================================================

/*
 * Lifecycle hooks are error-isolated: a crash in one plugin's hook never
 * prevents other plugins from receiving the hook, and the editor continues
 * normally. Errors are forwarded to the "error" event.
 */

editor.on("error", (err: Error, source?: string) => {
  // source will be like "plugin:my-plugin:onAfterChange"
  console.error(`[Error Handler] ${source}: ${err.message}`);
  // Send to your telemetry service here
});

// Even if a plugin throws:
editor.addPlugin({
  name: "bad-plugin",
  onAfterChange() {
    throw new Error("Something went wrong!");
  },
});

// The error is caught, logged, and forwarded to "error" listeners.
// Other plugins still receive onAfterChange normally.
// The editor state is NOT corrupted.

// =========================================================================
// 5. Complete Example: Auto-Save Plugin
// =========================================================================

/*
 * This is a real-world example combining multiple lifecycle hooks to
 * implement an auto-save feature.
 */

function createAutoSavePlugin(options: {
  intervalMs: number;
  onSave: (doc: string, version: number) => Promise<void>;
}): NexusPlugin {
  let timer: ReturnType<typeof setInterval> | null = null;
  let version = 0;

  return {
    name: "plugin-autosave",

    onEditorReady(editor: EditorAPI) {
      // Start the auto-save timer
      timer = setInterval(() => {
        const doc = editor.getDocument();
        options.onSave(doc, ++version);
      }, options.intervalMs);
    },

    onBeforeSetDocument(ctx) {
      // Don't auto-save while a file is loading
      if (ctx.silent) {
        version = 0; // reset version counter on file load
      }
    },

    onDestroy() {
      // Critical: clean up the timer to prevent leaks
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

editor.destroy();

// Export for documentation purposes
export { createAutoSavePlugin, fullLifecyclePlugin };
