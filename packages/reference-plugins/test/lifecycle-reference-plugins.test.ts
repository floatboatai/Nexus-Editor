import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  UI_CAPABILITY,
  type AuthorPluginManifest,
  type NexusApp,
  type NexusPluginBase,
  type NormalizedPluginManifest,
  type WindowContext,
} from "@floatboat/nexus-plugin-api";
import {
  createEditor,
  type EditorAPI,
  type NexusPlugin,
} from "@floatboat/nexus-core";
import {
  SlashLifecyclePlugin,
  slashLifecyclePluginManifest,
} from "@floatboat/nexus-plugin-slash";
import {
  createToolbarPlugin,
  createToolbarRuntimeSlashContribution,
  ToolbarLifecyclePlugin,
  toolbarLifecyclePluginManifest,
} from "@floatboat/nexus-plugin-toolbar";
import {
  attachWordCountPlugin,
  createWordCountPlugin,
  WordCountLifecyclePlugin,
  wordCountLifecyclePluginManifest,
} from "@floatboat/nexus-plugin-wordcount";
import {
  CommandRegistry,
  ComponentLifecycleRuntime,
  createWindowContext,
  DiagnosticBus,
  EditorHostRegistry,
  normalizeAuthorManifest,
  RuntimeCapabilityRegistry,
  RuntimeUiHost,
  type ComponentController,
  type EditorHostAttachment,
} from "@floatboat/nexus-plugin-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

interface EditorFixture {
  readonly editor: EditorAPI;
  readonly container: HTMLDivElement;
  readonly attachment: EditorHostAttachment;
  destroy(): Promise<void>;
}

interface PluginFixture<TPlugin extends NexusPluginBase> {
  readonly instance: TPlugin;
  readonly controller: ComponentController;
  load(): Promise<void>;
  unload(): Promise<void>;
}

const fixtures = new Set<EditorFixture>();

afterEach(async () => {
  for (const fixture of [...fixtures]) await fixture.destroy();
  fixtures.clear();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function normalize(manifest: AuthorPluginManifest): NormalizedPluginManifest {
  const result = normalizeAuthorManifest(manifest, {
    source: { kind: "development", locator: `fixture:${manifest.id}` },
  });
  if (!result.ok) throw new Error(`Invalid fixture manifest: ${manifest.id}`);
  return result.manifest;
}

function createApp(
  capabilities: RuntimeCapabilityRegistry,
  manifest: AuthorPluginManifest,
): {
  readonly app: NexusApp;
  readonly normalized: NormalizedPluginManifest;
  readonly access: ReturnType<RuntimeCapabilityRegistry["createPluginAccess"]>;
  readonly diagnostics: DiagnosticBus;
} {
  const normalized = normalize(manifest);
  const access = capabilities.createPluginAccess(normalized);
  const diagnostics = new DiagnosticBus();
  return {
    normalized,
    access,
    diagnostics,
    app: {
      host: {
        id: "reference-test-host",
        name: "Reference Test Host",
        version: "1.0.0",
        platform: "web",
      },
      apiVersion: "1.0.0",
      capabilities: access,
      diagnostics,
    },
  };
}

function managePlugin<TPlugin extends NexusPluginBase>(
  capabilities: RuntimeCapabilityRegistry,
  manifest: AuthorPluginManifest,
  create: (app: NexusApp, normalized: NormalizedPluginManifest) => TPlugin,
): PluginFixture<TPlugin> {
  const { app, normalized, access } = createApp(capabilities, manifest);
  const instance = create(app, normalized);
  const controller = new ComponentLifecycleRuntime().manage(instance, normalized.identity);
  access.bindOwner(instance);
  return {
    instance,
    controller,
    load: () => controller.load(),
    async unload() {
      const result = await controller.unload();
      await access.dispose();
      expect(result.clean).toBe(true);
    },
  };
}

function installBaseCapabilities(
  capabilities: RuntimeCapabilityRegistry,
  commands: CommandRegistry,
  editors: EditorHostRegistry,
): void {
  capabilities.registerOwnerBound(
    COMMANDS_CAPABILITY,
    ({ owner, registerResource }) => commands.createService(owner, registerResource),
  );
  capabilities.registerOwnerBound(
    EDITOR_HOST_CAPABILITY,
    ({ owner, registerResource }) => editors.createService(owner, registerResource),
  );
}

function actionContext(window: WindowContext) {
  return Object.freeze({
    window,
    leaf: null,
    view: null,
    editor: null,
    file: null,
    command: null,
  });
}

function installWindowUi(
  capabilities: RuntimeCapabilityRegistry,
  window: WindowContext,
  toolbar: HTMLElement,
  statusBar?: HTMLElement,
): RuntimeUiHost {
  const ui = new RuntimeUiHost({
    defaultWindow: window,
    slots: {
      "editor-toolbar": {
        window,
        containerEl: toolbar,
        actionContext: actionContext(window),
      },
      ...(statusBar
        ? {
            "status-bar": {
              window,
              containerEl: statusBar,
              actionContext: actionContext(window),
            },
          }
        : {}),
    },
  });
  capabilities.registerOwnerBound(
    UI_CAPABILITY,
    ({ owner, registerResource }) => ui.createService(owner, registerResource),
    { context: { windowId: window.id } },
  );
  return ui;
}

async function attachEditor(
  editors: EditorHostRegistry,
  window: WindowContext | null,
  initialValue: string,
  plugins: readonly NexusPlugin[] = [],
): Promise<EditorFixture> {
  const container = document.createElement("div");
  container.dataset.editorFixture = "true";
  document.body.append(container);
  const editor = createEditor({
    container,
    initialValue,
    plugins: [...plugins],
    parseDelayMs: 0,
  });
  const attachment = editors.attach({
    editor,
    surface: { kind: "document", root: container },
    window,
  });
  await attachment.ready;
  let destroyed = false;
  const fixture: EditorFixture = {
    editor,
    container,
    attachment,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await attachment.detach();
      editor.destroy();
      container.remove();
      fixtures.delete(fixture);
    },
  };
  fixtures.add(fixture);
  return fixture;
}

function content(fixture: EditorFixture): HTMLElement {
  const element = fixture.container.querySelector<HTMLElement>(".cm-content");
  if (!element) throw new Error("Editor fixture has no .cm-content root");
  return element;
}

describe("reference plugin lifecycle", () => {
  it("keeps word-count state isolated across current and future editors", async () => {
    const capabilities = new RuntimeCapabilityRegistry();
    const commands = new CommandRegistry();
    const editors = new EditorHostRegistry({ editorIdPrefix: "wordcount-editor" });
    installBaseCapabilities(capabilities, commands, editors);
    const window = createWindowContext("main", document);
    const first = await attachEditor(editors, window, "one two");
    const second = await attachEditor(editors, window, "alpha beta gamma delta");
    const plugin = managePlugin(
      capabilities,
      wordCountLifecyclePluginManifest,
      (app, manifest) => new WordCountLifecyclePlugin(app, manifest, { debounceMs: 25 }),
    );

    await plugin.load();
    expect(plugin.instance.getEditorIds()).toEqual([
      first.attachment.editorId,
      second.attachment.editorId,
    ]);
    expect(plugin.instance.getState(first.attachment.editorId)?.doc.words).toBe(2);
    expect(plugin.instance.getState(second.attachment.editorId)?.doc.words).toBe(4);

    first.editor.setSelection(0, "one two".length);
    expect(plugin.instance.getState(first.attachment.editorId)).toMatchObject({
      isSelectionActive: true,
      selection: { words: 2 },
    });
    expect(plugin.instance.getState(second.attachment.editorId)).toMatchObject({
      isSelectionActive: false,
      selection: { words: 0 },
    });

    const future = await attachEditor(editors, window, "future editor has five words");
    await vi.waitFor(() => {
      expect(plugin.instance.getState(future.attachment.editorId)?.doc.words).toBe(5);
    });

    vi.useFakeTimers();
    const emissions: string[] = [];
    plugin.instance.subscribe((state) => emissions.push(String(state.editorId)));
    emissions.length = 0;
    first.editor.setDocument("a pending debounced document update");
    await first.attachment.detach();
    await vi.advanceTimersByTimeAsync(50);
    expect(plugin.instance.getState(first.attachment.editorId)).toBeUndefined();
    expect(emissions).not.toContain(String(first.attachment.editorId));

    const beforeUnload = emissions.length;
    await plugin.unload();
    expect(plugin.instance.getEditorIds()).toEqual([]);
    second.editor.setDocument("this must not publish after unload");
    await vi.advanceTimersByTimeAsync(50);
    expect(emissions).toHaveLength(beforeUnload);
  });

  it("owns one updating status item per window and removes it on unload", async () => {
    const capabilities = new RuntimeCapabilityRegistry();
    const commands = new CommandRegistry();
    const editors = new EditorHostRegistry({ editorIdPrefix: "wordcount-status-editor" });
    installBaseCapabilities(capabilities, commands, editors);
    const mainWindow = createWindowContext("main", document);
    const secondWindow = createWindowContext("second", document);
    const mainToolbar = document.createElement("div");
    const secondToolbar = document.createElement("div");
    const mainStatus = document.createElement("div");
    const secondStatus = document.createElement("div");
    document.body.append(mainToolbar, secondToolbar, mainStatus, secondStatus);
    installWindowUi(capabilities, mainWindow, mainToolbar, mainStatus);
    installWindowUi(capabilities, secondWindow, secondToolbar, secondStatus);
    const first = await attachEditor(editors, mainWindow, "one two");
    const sameWindow = await attachEditor(editors, mainWindow, "three four five");
    const otherWindow = await attachEditor(editors, secondWindow, "six seven eight nine");
    const plugin = managePlugin(
      capabilities,
      wordCountLifecyclePluginManifest,
      (app, manifest) => new WordCountLifecyclePlugin(app, manifest, { debounceMs: 0 }),
    );

    await plugin.load();
    expect(mainStatus.querySelectorAll('[data-ui-action-id="wordcount:document-stats"]'))
      .toHaveLength(1);
    expect(secondStatus.querySelectorAll('[data-ui-action-id="wordcount:document-stats"]'))
      .toHaveLength(1);
    expect(mainStatus.textContent).toContain("3 words");
    expect(secondStatus.textContent).toContain("4 words");

    sameWindow.editor.setDocument("now there are five total words");
    expect(mainStatus.textContent).toContain("6 words");
    sameWindow.editor.setSelection(0, 3);
    expect(mainStatus.textContent).toContain("selected 1 words");
    expect(first.editor.getDocument()).toBe("one two");
    expect(otherWindow.editor.getDocument()).toBe("six seven eight nine");

    await otherWindow.attachment.updateContext({ window: mainWindow });
    expect(mainStatus.querySelectorAll('[data-ui-action-id="wordcount:document-stats"]'))
      .toHaveLength(1);
    expect(secondStatus.children).toHaveLength(0);
    expect(mainStatus.textContent).toContain("4 words");

    await sameWindow.attachment.updateContext({ window: secondWindow });
    expect(mainStatus.querySelectorAll('[data-ui-action-id="wordcount:document-stats"]'))
      .toHaveLength(1);
    expect(secondStatus.querySelectorAll('[data-ui-action-id="wordcount:document-stats"]'))
      .toHaveLength(1);
    expect(secondStatus.textContent).toContain("6 words");

    await plugin.unload();
    expect(mainStatus.children).toHaveLength(0);
    expect(secondStatus.children).toHaveLength(0);
  });

  it("switches status on recent-editor focus and bounds the binding ledger across attach cycles", async () => {
    const capabilities = new RuntimeCapabilityRegistry();
    const commands = new CommandRegistry();
    const editors = new EditorHostRegistry({ editorIdPrefix: "wordcount-recent-editor" });
    installBaseCapabilities(capabilities, commands, editors);
    const window = createWindowContext("main", document);
    const toolbar = document.createElement("div");
    const status = document.createElement("div");
    document.body.append(toolbar, status);
    installWindowUi(capabilities, window, toolbar, status);
    const first = await attachEditor(editors, window, "one two");
    const second = await attachEditor(editors, window, "alpha beta gamma delta");
    const plugin = managePlugin(
      capabilities,
      wordCountLifecyclePluginManifest,
      (app, manifest) => new WordCountLifecyclePlugin(app, manifest, { debounceMs: 0 }),
    );

    await plugin.load();
    const rootRegistrationCount = plugin.controller.registrationsSnapshot.length;
    expect(plugin.controller.childControllers).toHaveLength(2);
    expect(status.textContent).toContain("4 words");

    second.attachment.markRecent();
    expect(status.textContent).toContain("4 words");
    first.attachment.markRecent();
    expect(status.textContent).toContain("2 words");
    expect(first.editor.getDocument()).toBe("one two");
    expect(second.editor.getDocument()).toBe("alpha beta gamma delta");

    for (let index = 0; index < 6; index += 1) {
      const temporary = await attachEditor(editors, window, `temporary editor ${index}`);
      await vi.waitFor(() => expect(plugin.controller.childControllers).toHaveLength(3));
      await temporary.destroy();
      await vi.waitFor(() => expect(plugin.controller.childControllers).toHaveLength(2));
      expect(plugin.controller.registrationsSnapshot).toHaveLength(rootRegistrationCount);
      expect(status.querySelectorAll('[data-ui-action-id="wordcount:document-stats"]'))
        .toHaveLength(1);
    }

    await plugin.unload();
    expect(status.children).toHaveLength(0);
  });

  it("matches legacy word-count and toolbar behavior on the runtime path", async () => {
    const legacyWordCount = createWordCountPlugin({ debounceMs: 0 });
    const legacyContainer = document.createElement("div");
    document.body.append(legacyContainer);
    const legacyEditor = createEditor({
      container: legacyContainer,
      initialValue: "alpha beta gamma",
      plugins: [legacyWordCount, createToolbarPlugin()],
    });
    attachWordCountPlugin(legacyWordCount, legacyEditor);
    await Promise.resolve();

    const capabilities = new RuntimeCapabilityRegistry();
    const commands = new CommandRegistry();
    const editors = new EditorHostRegistry();
    installBaseCapabilities(capabilities, commands, editors);
    const runtime = await attachEditor(
      editors,
      createWindowContext("main", document),
      "alpha beta gamma",
    );
    const wordCount = managePlugin(
      capabilities,
      wordCountLifecyclePluginManifest,
      (app, manifest) => new WordCountLifecyclePlugin(app, manifest, { debounceMs: 0 }),
    );
    const toolbar = managePlugin(
      capabilities,
      toolbarLifecyclePluginManifest,
      (app, manifest) => new ToolbarLifecyclePlugin(app, manifest, { mountUi: false }),
    );
    await wordCount.load();
    await toolbar.load();

    expect(wordCount.instance.getState(runtime.attachment.editorId)?.doc).toEqual(
      legacyWordCount.getStats(),
    );
    legacyEditor.setSelection(0, 5);
    expect(legacyEditor.runShortcut("Mod-b")).toBe(true);
    runtime.editor.setSelection(0, 5);
    await expect(commands.executeCommand("toolbar:bold", {
      trigger: "api",
      editor: runtime.attachment.context,
    })).resolves.toMatchObject({ ok: true });
    expect(runtime.editor.getDocument()).toBe(legacyEditor.getDocument());

    await toolbar.unload();
    await wordCount.unload();
    legacyWordCount.destroy();
    legacyEditor.destroy();
    legacyContainer.remove();
  });

  it("owns toolbar and slash UI once per scope and returns to zero over two cycles", async () => {
    const capabilities = new RuntimeCapabilityRegistry();
    const commands = new CommandRegistry();
    const editors = new EditorHostRegistry({ editorIdPrefix: "ui-editor" });
    installBaseCapabilities(capabilities, commands, editors);
    const mainWindow = createWindowContext("main", document);
    const secondWindow = createWindowContext("second", document);
    const mainToolbar = document.createElement("div");
    const secondToolbar = document.createElement("div");
    document.body.append(mainToolbar, secondToolbar);
    installWindowUi(capabilities, mainWindow, mainToolbar);
    installWindowUi(capabilities, secondWindow, secondToolbar);
    const catalogue = createToolbarRuntimeSlashContribution();
    const first = await attachEditor(editors, mainWindow, "alpha", [catalogue]);
    const sameWindow = await attachEditor(editors, mainWindow, "bravo", [catalogue]);
    const otherWindow = await attachEditor(editors, secondWindow, "charlie", [catalogue]);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const toolbar = managePlugin(
        capabilities,
        toolbarLifecyclePluginManifest,
        (app, manifest) => new ToolbarLifecyclePlugin(app, manifest),
      );
      const slash = managePlugin(
        capabilities,
        slashLifecyclePluginManifest,
        (app, manifest) => new SlashLifecyclePlugin(app, manifest),
      );
      await toolbar.load();
      await slash.load();

      expect(commands.listCommands()).toHaveLength(17);
      expect(commands.listCommands().map((command) => command.id)).toContain("toolbar:bold");
      expect(mainToolbar.children).toHaveLength(17);
      expect(secondToolbar.children).toHaveLength(17);
      expect(document.querySelectorAll(".nexus-slash-menu")).toHaveLength(3);
      expect(slash.instance.mountedEditorIds).toHaveLength(3);

      const future = await attachEditor(editors, mainWindow, "delta", [catalogue]);
      await vi.waitFor(() => {
        expect(slash.instance.mountedEditorIds).toContain(String(future.attachment.editorId));
        expect(document.querySelectorAll(".nexus-slash-menu")).toHaveLength(4);
      });
      expect(mainToolbar.children).toHaveLength(17);

      first.editor.setSelection(0, 5);
      await expect(commands.executeCommand("toolbar:bold", {
        trigger: "api",
        editor: first.attachment.context,
      })).resolves.toMatchObject({ ok: true });
      expect(first.editor.getDocument()).toBe("**alpha**");

      sameWindow.editor.setDocument("/bo");
      sameWindow.editor.setSelection(3);
      const keydown = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      content(sameWindow).dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(sameWindow.editor.getDocument()).toBe(""));

      await future.attachment.detach();
      await vi.waitFor(() => {
        expect(slash.instance.mountedEditorIds).not.toContain(String(future.attachment.editorId));
        expect(document.querySelectorAll(".nexus-slash-menu")).toHaveLength(3);
      });
      await future.destroy();

      await slash.unload();
      await toolbar.unload();
      expect(commands.listCommands()).toEqual([]);
      expect(mainToolbar.children).toHaveLength(0);
      expect(secondToolbar.children).toHaveLength(0);
      expect(document.querySelectorAll(".nexus-slash-menu")).toHaveLength(0);

      sameWindow.editor.setDocument("/bo");
      sameWindow.editor.setSelection(3);
      const afterUnload = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      content(sameWindow).dispatchEvent(afterUnload);
      expect(afterUnload.defaultPrevented).toBe(false);
      expect(sameWindow.editor.getDocument()).toBe("/bo");

      first.editor.setDocument("alpha");
      sameWindow.editor.setDocument("bravo");
      otherWindow.editor.setDocument("charlie");
    }
  });

  it("loads all lifecycle plugins without optional UI capabilities", async () => {
    const capabilities = new RuntimeCapabilityRegistry();
    const commands = new CommandRegistry();
    const editors = new EditorHostRegistry();
    installBaseCapabilities(capabilities, commands, editors);
    const editor = await attachEditor(
      editors,
      null,
      "/bo",
      [createToolbarRuntimeSlashContribution()],
    );
    const toolbar = managePlugin(
      capabilities,
      toolbarLifecyclePluginManifest,
      (app, manifest) => new ToolbarLifecyclePlugin(app, manifest),
    );
    const slash = managePlugin(
      capabilities,
      slashLifecyclePluginManifest,
      (app, manifest) => new SlashLifecyclePlugin(app, manifest),
    );
    const wordCount = managePlugin(
      capabilities,
      wordCountLifecyclePluginManifest,
      (app, manifest) => new WordCountLifecyclePlugin(app, manifest, { debounceMs: 0 }),
    );

    await expect(toolbar.load()).resolves.toBeUndefined();
    await expect(slash.load()).resolves.toBeUndefined();
    await expect(wordCount.load()).resolves.toBeUndefined();
    expect(commands.listCommands()).toHaveLength(17);
    expect(slash.instance.mountedEditorIds).toEqual([editor.attachment.editorId]);
    expect(wordCount.instance.getState(editor.attachment.editorId)?.doc.words).toBe(1);

    await wordCount.unload();
    await slash.unload();
    await toolbar.unload();
    expect(commands.listCommands()).toEqual([]);
    expect(document.querySelectorAll(".nexus-slash-menu")).toHaveLength(0);
  });
});
