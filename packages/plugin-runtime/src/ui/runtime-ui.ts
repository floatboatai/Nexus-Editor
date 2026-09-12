import type {
  CommandAvailability,
  CommandContext,
  CommandExecutionResult,
  ComponentId,
  ContributionRegistration,
  HtmlSanitizationResult,
  ManagedResource,
  Menu,
  MenuContext,
  MenuContributionPoint,
  MenuItemDefinition,
  ModalController,
  ModalDefinition,
  NexusComponent,
  NexusDiagnostic,
  NoticeHandle,
  NoticeLevel,
  NoticeOptions,
  PluginStorageService,
  PluginIdentity,
  RegisteredCommand,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
  ServiceResult,
  SettingDefinition,
  SettingTabDefinition,
  SettingValue,
  UiActionContext,
  UiActionDefinition,
  UiPolicyService,
  UiService,
  UiSlot,
  UiSlotRegistration,
  WindowContext,
} from "@floatboat/nexus-plugin-api";
import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
} from "@floatboat/nexus-plugin-api";

import {
  ComponentLifecycleRuntime,
  type ComponentController,
} from "../lifecycle/component-controller";

export type UiResourceRegistrar = (resource: ManagedResource) => void;

export interface CommandPaletteRegistry {
  listCommands(): readonly RegisteredCommand[];
  checkCommand(
    id: string,
    context?: Partial<CommandContext>,
  ): Promise<CommandAvailability>;
  executeCommand(
    id: string,
    context?: Partial<CommandContext>,
  ): Promise<CommandExecutionResult>;
}

export interface UiSlotContext {
  readonly window: WindowContext;
  readonly containerEl: HTMLElement;
  readonly actionContext: UiActionContext;
}

export interface RuntimeUiHostOptions {
  readonly slots?: Partial<Record<UiSlot, UiSlotContext>>;
  readonly commandRegistry?: CommandPaletteRegistry;
  readonly defaultWindow?: WindowContext;
  readonly resolveStorage?: (owner: ResourceOwner) => PluginStorageService | null;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
  readonly openExternalUrl?: (
    url: string,
    context: WindowContext,
  ) => void | Promise<void>;
  readonly confirmDangerousAction?: (options: {
    readonly title: string;
    readonly message: string;
    readonly window: WindowContext;
  }) => boolean | Promise<boolean>;
  readonly mountSettingChild?: (
    owner: ResourceOwner,
    child: NexusComponent,
  ) => void | Promise<void>;
  readonly unmountSettingChild?: (
    owner: ResourceOwner,
    child: NexusComponent,
  ) => void | Promise<void>;
  readonly logNotice?: (entry: {
    readonly owner: ResourceOwner;
    readonly message: string;
    readonly level: NoticeLevel;
    readonly dedupeKey?: string;
  }) => void;
}

export interface HeadlessUiLogEntry {
  readonly owner: ResourceOwner;
  readonly message: string;
  readonly level: NoticeLevel;
  readonly dedupeKey?: string;
}

interface ContributionEntry {
  readonly key: string;
  readonly owner: ResourceOwner;
  readonly point: MenuContributionPoint;
  readonly contribute: (menu: Menu, context: MenuContext) => void;
  readonly section: string;
  readonly priority: number;
  readonly sequence: number;
  state: RegistrationState;
}

interface SlotEntry {
  readonly key: string;
  readonly owner: ResourceOwner;
  readonly slot: UiSlot;
  definition: UiActionDefinition;
  readonly globalId: string;
  priority: number;
  readonly sequence: number;
  state: RegistrationState;
  element: HTMLButtonElement | null;
}

interface SettingEntry {
  readonly key: string;
  readonly owner: ResourceOwner;
  readonly localId: string;
  readonly globalId: string;
  readonly definition: SettingTabDefinition;
  readonly sequence: number;
  state: RegistrationState;
  display: SettingDisplay | null;
  hidePromise: Promise<void> | null;
}

interface RenderableMenuItem {
  readonly item: MenuItemDefinition | null;
  readonly section: string;
  readonly priority: number;
  readonly sequence: number;
}

interface SettingDisplay {
  readonly entry: SettingEntry;
  readonly window: WindowContext;
  readonly containerEl: HTMLElement;
  readonly storage: PluginStorageService;
  readonly values: Record<string, SettingValue>;
  readonly children: Array<{
    readonly child: NexusComponent;
    readonly controller: ComponentController | null;
  }>;
  readonly cleanups: Array<() => void | Promise<void>>;
  readonly ownsContainer: boolean;
  hidden: boolean;
}

function registrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function normalizePriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (!Number.isInteger(value) || value < MIN_PLUGIN_PRIORITY || value > MAX_PLUGIN_PRIORITY) {
    throw new RangeError(
      `UI priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return value;
}

function cause(error: unknown): NexusDiagnostic["cause"] {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

function cloneContext(context: MenuContext): MenuContext {
  return Object.freeze({
    kind: context.kind,
    event: context.event,
    window: context.window,
    leaf: context.leaf,
    view: context.view,
    editor: context.editor,
    file: context.file,
    command: context.command,
  });
}

function isElementInDocument(value: unknown, document: Document): value is HTMLElement {
  const constructor = document.defaultView?.HTMLElement;
  return Boolean(constructor && value instanceof constructor);
}

function accessibleName(definition: {
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly tooltip?: string;
}): string | null {
  const value = definition.ariaLabel ?? definition.label ?? definition.tooltip;
  return value?.trim() || null;
}

function hasAccessibleActionName(definition: {
  readonly icon?: unknown;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly tooltip?: string;
}): boolean {
  return definition.icon === undefined || accessibleName(definition) !== null;
}

function pointForContext(context: MenuContext): MenuContributionPoint | null {
  switch (context.kind) {
    case "editor": return "editor-menu";
    case "file": return "file-menu";
    case "view": return "view-menu";
    case "tab": return "tab-menu";
    case "custom": return null;
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

abstract class ManagedUiRegistration implements ManagedResource {
  protected disposePromise: Promise<void> | null = null;

  abstract readonly id: RegistrationId;
  abstract readonly owner: ResourceOwner;
  abstract readonly state: RegistrationState;
  abstract readonly disposed: boolean;
  abstract activate(): void | Promise<void>;
  abstract quiesce(): void;
  abstract dispose(): Promise<void>;
}

class ContributionRegistrationImpl extends ManagedUiRegistration implements ContributionRegistration {
  constructor(
    private readonly host: RuntimeUiHost,
    private readonly entry: ContributionEntry,
  ) { super(); }

  get id(): RegistrationId { return registrationId(this.entry.key); }
  get owner(): ResourceOwner { return this.entry.owner; }
  get state(): RegistrationState { return this.entry.state; }
  get disposed(): boolean { return this.entry.state === "disposed"; }
  get localId(): string { return `${this.entry.point}:${this.entry.sequence}`; }
  get globalId(): string { return this.entry.key; }
  get priority(): number { return this.entry.priority; }
  activate(): void { this.host.activateContribution(this.entry); }
  quiesce(): void { this.host.quiesceContribution(this.entry); }
  dispose(): Promise<void> {
    if (!this.disposePromise) this.disposePromise = this.host.disposeContribution(this.entry);
    return this.disposePromise;
  }
}

class SlotRegistrationImpl extends ManagedUiRegistration implements UiSlotRegistration {
  constructor(private readonly host: RuntimeUiHost, private readonly entry: SlotEntry) { super(); }
  get id(): RegistrationId { return registrationId(this.entry.key); }
  get owner(): ResourceOwner { return this.entry.owner; }
  get state(): RegistrationState { return this.entry.state; }
  get disposed(): boolean { return this.entry.state === "disposed"; }
  get localId(): string { return this.entry.definition.id; }
  get globalId(): string { return this.entry.globalId; }
  get priority(): number { return this.entry.priority; }
  get slot(): UiSlot { return this.entry.slot; }
  update(definition: Partial<Omit<UiActionDefinition, "id">>): ServiceResult<void> {
    return this.host.updateSlot(this.entry, definition);
  }
  activate(): void { this.host.activateSlot(this.entry); }
  quiesce(): void { this.host.quiesceSlot(this.entry); }
  dispose(): Promise<void> {
    if (!this.disposePromise) this.disposePromise = this.host.disposeSlot(this.entry);
    return this.disposePromise;
  }
}

class SettingRegistrationImpl extends ManagedUiRegistration implements ContributionRegistration {
  constructor(private readonly host: RuntimeUiHost, private readonly entry: SettingEntry) { super(); }
  get id(): RegistrationId { return registrationId(this.entry.key); }
  get owner(): ResourceOwner { return this.entry.owner; }
  get state(): RegistrationState { return this.entry.state; }
  get disposed(): boolean { return this.entry.state === "disposed"; }
  get localId(): string { return this.entry.localId; }
  get globalId(): string { return this.entry.globalId; }
  get priority(): number { return 0; }
  activate(): void { this.host.activateSetting(this.entry); }
  quiesce(): void { this.host.quiesceSetting(this.entry); }
  dispose(): Promise<void> {
    if (!this.disposePromise) this.disposePromise = this.host.disposeSetting(this.entry);
    return this.disposePromise;
  }
}

class RuntimeMenu extends ManagedUiRegistration implements Menu {
  readonly context: MenuContext;
  private readonly items: RenderableMenuItem[] = [];
  private menuEl: HTMLElement | null = null;
  private keyListener: ((event: KeyboardEvent) => void) | null = null;
  private outsideMouseListener: ((event: MouseEvent) => void) | null = null;
  private previousFocus: HTMLElement | null;
  private itemSequence = 0;
  private currentDefaults: { section: string; priority: number } | null = null;
  private currentState: RegistrationState = "active";
  private closePromise: Promise<void> | null = null;
  private shown = false;

  constructor(
    private readonly host: RuntimeUiHost,
    readonly owner: ResourceOwner,
    context: MenuContext,
    private readonly sequence: number,
  ) {
    super();
    this.context = cloneContext(context);
    const active = context.window.ownerDocument.activeElement;
    const eventTarget = context.event?.target;
    this.previousFocus = isElementInDocument(eventTarget, context.window.ownerDocument)
      ? eventTarget
      : isElementInDocument(active, context.window.ownerDocument)
        ? active
        : null;
  }

  get id(): RegistrationId { return registrationId(`ui:menu:${this.sequence}`); }
  get state(): RegistrationState { return this.currentState; }
  get disposed(): boolean { return this.currentState === "disposed"; }
  get closed(): boolean { return this.currentState === "disposed"; }
  activate(): void {}
  quiesce(): void { void this.close(); }

  addItem(item: MenuItemDefinition): void {
    if (this.shown || this.closed) throw new Error("Menu items can only be added before showAt");
    if (!hasAccessibleActionName(item)) {
      this.host.reportUiDiagnostic(
        "ui-action-inaccessible",
        `Menu item '${item.id}' uses an icon without an accessible name`,
        this.owner,
        item.id,
      );
      return;
    }
    const defaults = this.currentDefaults;
    this.items.push({
      item: Object.freeze({ ...item }),
      section: item.section ?? defaults?.section ?? "default",
      priority: normalizePriority(item.priority ?? defaults?.priority),
      sequence: ++this.itemSequence,
    });
  }

  addSeparator(section = this.currentDefaults?.section ?? "default"): void {
    if (this.shown || this.closed) throw new Error("Menu items can only be added before showAt");
    this.items.push({
      item: null,
      section,
      priority: this.currentDefaults?.priority ?? 0,
      sequence: ++this.itemSequence,
    });
  }

  collectContribution(
    section: string,
    priority: number,
    callback: (menu: Menu, context: MenuContext) => void,
  ): void {
    this.currentDefaults = { section, priority };
    try {
      callback(this, this.context);
    } finally {
      this.currentDefaults = null;
    }
  }

  async showAt(position: { readonly x: number; readonly y: number }): Promise<void> {
    if (this.closed || this.shown) return;
    this.host.collectMenuContributions(this);
    this.shown = true;
    const document = this.context.window.ownerDocument;
    const menu = document.createElement("div");
    menu.className = "nexus-plugin-menu";
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    menu.style.position = "fixed";
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;

    const sectionOrder = new Map<string, number>();
    for (const candidate of this.items) {
      if (!sectionOrder.has(candidate.section)) sectionOrder.set(candidate.section, sectionOrder.size);
    }
    const ordered = [...this.items].sort((left, right) =>
      sectionOrder.get(left.section)! - sectionOrder.get(right.section)! ||
      right.priority - left.priority ||
      left.sequence - right.sequence,
    );
    for (const candidate of ordered) {
      if (candidate.item) this.renderItem(menu, candidate.item);
      else {
        const separator = document.createElement("div");
        separator.setAttribute("role", "separator");
        menu.append(separator);
      }
    }
    document.body.append(menu);
    this.menuEl = menu;
    this.keyListener = (event) => this.handleKey(event);
    this.outsideMouseListener = (event) => {
      if (!this.menuEl || event.composedPath().includes(this.menuEl)) return;
      void this.close();
    };
    document.addEventListener("keydown", this.keyListener, true);
    document.addEventListener("mousedown", this.outsideMouseListener, true);
    const first = this.menuButtons()[0];
    (first ?? menu).focus();
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = Promise.resolve().then(() => {
      if (this.currentState === "disposed") return;
      this.currentState = "quiescing";
      const document = this.context.window.ownerDocument;
      if (this.keyListener) document.removeEventListener("keydown", this.keyListener, true);
      if (this.outsideMouseListener) {
        document.removeEventListener("mousedown", this.outsideMouseListener, true);
      }
      this.keyListener = null;
      this.outsideMouseListener = null;
      this.menuEl?.remove();
      this.menuEl = null;
      this.currentState = "disposed";
      this.host.removeMenu(this);
      if (this.previousFocus?.isConnected) this.previousFocus.focus();
      this.previousFocus = null;
    });
    return this.closePromise;
  }

  dispose(): Promise<void> { return this.close(); }

  private renderItem(parent: HTMLElement, item: MenuItemDefinition): void {
    const document = this.context.window.ownerDocument;
    if (item.separatorBefore && parent.childElementCount > 0) {
      const separator = document.createElement("div");
      separator.setAttribute("role", "separator");
      parent.append(separator);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.menuItemId = item.id;
    button.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemcheckbox");
    if (item.checked !== undefined) button.setAttribute("aria-checked", String(item.checked));
    button.setAttribute("aria-disabled", String(item.disabled === true));
    button.tabIndex = -1;
    const name = accessibleName(item) ?? item.id;
    button.textContent = item.label ?? name;
    button.setAttribute("aria-label", name);
    if (item.tooltip) button.title = item.tooltip;
    if (item.dangerous) button.dataset.dangerous = "true";
    button.addEventListener("click", () => {
      if (item.submenu?.length) {
        this.toggleSubmenu(button);
      } else {
        void this.activateItem(item);
      }
    });
    parent.append(button);
    if (item.submenu?.length) {
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      const submenu = document.createElement("div");
      submenu.className = "nexus-plugin-submenu";
      submenu.setAttribute("role", "menu");
      submenu.hidden = true;
      for (const child of item.submenu) this.renderItem(submenu, child);
      parent.append(submenu);
    }
  }

  private menuButtons(): HTMLButtonElement[] {
    return this.menuEl
      ? Array.from(this.menuEl.querySelectorAll<HTMLButtonElement>("button[role^='menuitem']"))
          .filter((button) => !button.closest<HTMLElement>("[role='menu'][hidden]"))
      : [];
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      void this.close();
      return;
    }
    const focused = this.context.window.ownerDocument.activeElement as HTMLButtonElement | null;
    if (event.key === "ArrowRight" && focused?.getAttribute("aria-haspopup") === "menu") {
      event.preventDefault();
      this.toggleSubmenu(focused, true);
      const submenu = focused.nextElementSibling as HTMLElement | null;
      submenu?.querySelector<HTMLButtonElement>("button[role^='menuitem']")?.focus();
      return;
    }
    if (event.key === "ArrowLeft" && focused) {
      const submenu = focused.closest<HTMLElement>(".nexus-plugin-submenu");
      const parentButton = submenu?.previousElementSibling as HTMLButtonElement | null;
      if (submenu && parentButton) {
        event.preventDefault();
        submenu.hidden = true;
        parentButton.setAttribute("aria-expanded", "false");
        parentButton.focus();
        return;
      }
    }
    const buttons = this.menuButtons();
    if (buttons.length === 0) return;
    const current = buttons.indexOf(this.context.window.ownerDocument.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1 + buttons.length) % buttons.length;
    else if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if ((event.key === "Enter" || event.key === " ") && current >= 0) {
      event.preventDefault();
      buttons[current]!.click();
      return;
    } else return;
    event.preventDefault();
    buttons[next]!.focus();
  }

  private async activateItem(item: MenuItemDefinition): Promise<void> {
    if (this.currentState !== "active" || !this.shown || item.disabled || !item.action) return;
    if (item.dangerous) {
      let allowed = false;
      try {
        allowed = await this.host.policy.confirmDangerousAction({
          title: accessibleName(item) ?? item.id,
          message: "This plugin action is marked as dangerous.",
          window: this.context.window,
        });
      } catch (error) {
        this.host.reportUiDiagnostic(
          "callback-failed",
          `Menu action '${item.id}' confirmation failed`,
          this.owner,
          item.id,
          error,
        );
        return;
      }
      if (!allowed) return;
      if (this.currentState !== "active" || !this.menuEl?.isConnected) return;
    }
    try {
      await item.action(this.context);
    } catch (error) {
      this.host.reportUiDiagnostic(
        "callback-failed",
        `Menu action '${item.id}' failed`,
        this.owner,
        item.id,
        error,
      );
    } finally {
      await this.close();
    }
  }

  private toggleSubmenu(button: HTMLButtonElement, forceOpen?: boolean): void {
    const submenu = button.nextElementSibling as HTMLElement | null;
    if (!submenu?.classList.contains("nexus-plugin-submenu")) return;
    const open = forceOpen ?? submenu.hidden;
    submenu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }
}

class RuntimeModal extends ManagedUiRegistration implements ModalController {
  readonly containerEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly contentEl: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly previousFocus: HTMLElement | null;
  private currentState: RegistrationState = "active";
  private closePromise: Promise<void> | null = null;
  private onCloseCalled = false;
  private keyListener: (event: KeyboardEvent) => void;

  constructor(
    private readonly host: RuntimeUiHost,
    readonly owner: ResourceOwner,
    readonly definition: ModalDefinition,
    private readonly sequence: number,
  ) {
    super();
    const document = definition.window.ownerDocument;
    this.previousFocus = definition.restoreFocus && isElementInDocument(definition.restoreFocus, document)
      ? definition.restoreFocus
      : isElementInDocument(document.activeElement, document)
        ? document.activeElement
        : null;
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "nexus-plugin-modal-overlay";
    this.containerEl = document.createElement("section");
    this.containerEl.className = "nexus-plugin-modal";
    this.containerEl.setAttribute("role", "dialog");
    this.containerEl.setAttribute("aria-modal", "true");
    this.titleEl = document.createElement("h2");
    this.titleEl.id = `nexus-modal-title-${sequence}`;
    this.titleEl.textContent = definition.title ?? "";
    this.containerEl.setAttribute("aria-labelledby", this.titleEl.id);
    this.contentEl = document.createElement("div");
    this.contentEl.className = "nexus-plugin-modal-content";
    this.contentEl.tabIndex = -1;
    this.containerEl.append(this.titleEl, this.contentEl);
    this.overlayEl.append(this.containerEl);
    this.keyListener = (event) => this.handleKey(event);
  }

  get id(): RegistrationId { return registrationId(`ui:modal:${this.sequence}`); }
  get window(): WindowContext { return this.definition.window; }
  get state(): RegistrationState { return this.currentState; }
  get disposed(): boolean { return this.currentState === "disposed"; }
  get open(): boolean { return this.currentState === "active" && this.overlayEl.isConnected; }
  activate(): void {}
  quiesce(): void { void this.close(); }

  async openNow(): Promise<void> {
    const document = this.window.ownerDocument;
    document.body.append(this.overlayEl);
    document.addEventListener("keydown", this.keyListener, true);
    try {
      await this.definition.onOpen?.(this);
      const focusable = focusableElements(this.containerEl);
      (focusable[0] ?? this.contentEl).focus();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      if (this.currentState === "disposed") return;
      this.currentState = "quiescing";
      this.window.ownerDocument.removeEventListener("keydown", this.keyListener, true);
      if (!this.onCloseCalled) {
        this.onCloseCalled = true;
        try {
          await this.definition.onClose?.(this);
        } catch (error) {
          this.host.reportUiDiagnostic(
            "callback-failed",
            "Modal onClose callback failed",
            this.owner,
            String(this.id),
            error,
          );
        }
      }
      this.overlayEl.remove();
      this.currentState = "disposed";
      this.host.removeModal(this);
      if (this.previousFocus?.isConnected) this.previousFocus.focus();
    })();
    return this.closePromise;
  }

  dispose(): Promise<void> { return this.close(); }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      void this.close();
      return;
    }
    if (event.key !== "Tab") return;
    const candidates = focusableElements(this.containerEl);
    if (candidates.length === 0) {
      event.preventDefault();
      this.contentEl.focus();
      return;
    }
    const active = this.window.ownerDocument.activeElement;
    let index = candidates.indexOf(active as HTMLElement);
    index = event.shiftKey
      ? (index <= 0 ? candidates.length - 1 : index - 1)
      : (index < 0 || index === candidates.length - 1 ? 0 : index + 1);
    event.preventDefault();
    candidates[index]!.focus();
  }
}

class RuntimeNotice extends ManagedUiRegistration implements NoticeHandle {
  private currentState: RegistrationState = "active";
  private currentMessage: string;
  private currentLevel: NoticeLevel;
  private timer: number | null = null;
  private dismissPromise: Promise<void> | null = null;
  readonly element: HTMLElement | null;

  constructor(
    private readonly host: RuntimeUiHost,
    readonly owner: ResourceOwner,
    private readonly sequence: number,
    message: string,
    level: NoticeLevel,
    readonly dedupeKey: string | undefined,
    readonly window: WindowContext | null,
    durationMs: number,
  ) {
    super();
    this.currentMessage = message;
    this.currentLevel = level;
    if (window) {
      const document = window.ownerDocument;
      const container = host.noticeContainer(window);
      const element = document.createElement("div");
      element.className = "nexus-plugin-notice";
      element.setAttribute("role", level === "error" ? "alert" : "status");
      element.setAttribute("aria-live", level === "error" ? "assertive" : "polite");
      element.dataset.level = level;
      element.textContent = message;
      container.append(element);
      this.element = element;
    } else {
      this.element = null;
      host.logHeadlessNotice({ owner, message, level, ...(dedupeKey ? { dedupeKey } : {}) });
    }
    this.resetTimer(durationMs);
  }

  get id(): RegistrationId { return registrationId(`ui:notice:${this.sequence}`); }
  get state(): RegistrationState { return this.currentState; }
  get disposed(): boolean { return this.currentState === "disposed"; }
  get level(): NoticeLevel { return this.currentLevel; }
  get message(): string { return this.currentMessage; }
  activate(): void {}
  quiesce(): void { void this.dismiss(); }

  update(message: string, options: NoticeOptions = {}): void {
    if (this.disposed) return;
    this.currentMessage = message;
    this.currentLevel = options.level ?? this.currentLevel;
    if (this.element) {
      this.element.textContent = message;
      this.element.dataset.level = this.currentLevel;
      this.element.setAttribute("role", this.currentLevel === "error" ? "alert" : "status");
      this.element.setAttribute("aria-live", this.currentLevel === "error" ? "assertive" : "polite");
    } else {
      this.host.logHeadlessNotice({
        owner: this.owner,
        message,
        level: this.currentLevel,
        ...(this.dedupeKey ? { dedupeKey: this.dedupeKey } : {}),
      });
    }
    this.resetTimer(options.durationMs ?? 4_000);
  }

  dismiss(): Promise<void> {
    if (this.dismissPromise) return this.dismissPromise;
    this.dismissPromise = Promise.resolve().then(() => {
      if (this.currentState === "disposed") return;
      this.currentState = "quiescing";
      if (this.timer !== null && this.window) this.window.ownerWindow.clearTimeout(this.timer);
      this.timer = null;
      this.element?.remove();
      this.currentState = "disposed";
      this.host.removeNotice(this);
    });
    return this.dismissPromise;
  }

  dispose(): Promise<void> { return this.dismiss(); }

  private resetTimer(durationMs: number): void {
    if (this.timer !== null && this.window) this.window.ownerWindow.clearTimeout(this.timer);
    this.timer = null;
    if (durationMs <= 0 || !this.window) return;
    this.timer = this.window.ownerWindow.setTimeout(() => void this.dismiss(), durationMs);
  }
}

class RuntimeUiPolicy implements UiPolicyService {
  constructor(private readonly host: RuntimeUiHost) {}

  sanitizeHtml(html: string): HtmlSanitizationResult {
    const document = this.host.defaultWindow?.ownerDocument;
    if (!document) {
      const safe = html
        .replace(/<\/?(?:script|style|iframe|object|embed)\b[^>]*>/gi, "")
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, "");
      const removed = safe !== html;
      const diagnostics = removed
        ? [this.host.reportUiDiagnostic(
            "ui-policy-denied",
            "Unsafe plugin HTML was removed by the host sanitizer",
            undefined,
            "sanitize-html",
          )]
        : [];
      return { html: safe, removed, diagnostics };
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    let removed = false;
    for (const element of Array.from(template.content.querySelectorAll("script,style,iframe,object,embed"))) {
      element.remove();
      removed = true;
    }
    for (const element of Array.from(template.content.querySelectorAll<HTMLElement>("*" ))) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (
          name.startsWith("on") ||
          name === "srcdoc" ||
          ((name === "href" || name === "src" || name === "xlink:href") &&
            (value.startsWith("javascript:") || value.startsWith("data:text/html")))
        ) {
          element.removeAttribute(attribute.name);
          removed = true;
        }
      }
    }
    const sanitized = template.innerHTML;
    const diagnostics = removed
      ? [this.host.reportUiDiagnostic(
          "ui-policy-denied",
          "Unsafe plugin HTML was removed by the host sanitizer",
          undefined,
          "sanitize-html",
        )]
      : [];
    return { html: sanitized, removed, diagnostics };
  }

  async openExternalUrl(url: string, context: WindowContext): Promise<ServiceResult<void>> {
    let parsed: URL;
    try {
      parsed = new URL(url, context.ownerDocument.baseURI);
    } catch (error) {
      return {
        ok: false,
        diagnostic: this.host.reportUiDiagnostic(
          "ui-policy-denied",
          `External URL '${url}' is invalid`,
          undefined,
          url,
          error,
        ),
      };
    }
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      return {
        ok: false,
        diagnostic: this.host.reportUiDiagnostic(
          "ui-policy-denied",
          `External URL scheme '${parsed.protocol}' is not allowed`,
          undefined,
          url,
        ),
      };
    }
    if (!this.host.externalUrlOpener) {
      return {
        ok: false,
        diagnostic: this.host.reportUiDiagnostic(
          "platform-unsupported",
          "This host does not provide external URL navigation",
          undefined,
          url,
        ),
      };
    }
    try {
      await this.host.externalUrlOpener(parsed.href, context);
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        diagnostic: this.host.reportUiDiagnostic(
          "callback-failed",
          "The host external URL handler failed",
          undefined,
          url,
          error,
        ),
      };
    }
  }

  async confirmDangerousAction(options: {
    readonly title: string;
    readonly message: string;
    readonly window: WindowContext;
  }): Promise<boolean> {
    return this.host.dangerousActionConfirmer
      ? Boolean(await this.host.dangerousActionConfirmer(options))
      : false;
  }
}

/** Owner-aware UI runtime with DOM, policy and headless adapters. */
export class RuntimeUiHost {
  readonly policy: UiPolicyService;
  readonly defaultWindow: WindowContext | undefined;
  readonly externalUrlOpener: RuntimeUiHostOptions["openExternalUrl"];
  readonly dangerousActionConfirmer: RuntimeUiHostOptions["confirmDangerousAction"];

  private readonly slots: Partial<Record<UiSlot, UiSlotContext>>;
  private readonly commandRegistry?: CommandPaletteRegistry;
  private readonly resolveStorage: (owner: ResourceOwner) => PluginStorageService | null;
  private readonly diagnosticReporter: (diagnostic: NexusDiagnostic) => void;
  private readonly mountSettingChild: RuntimeUiHostOptions["mountSettingChild"];
  private readonly unmountSettingChild: RuntimeUiHostOptions["unmountSettingChild"];
  private readonly noticeLogger: NonNullable<RuntimeUiHostOptions["logNotice"]>;
  private readonly lifecycle = new ComponentLifecycleRuntime();
  private readonly contributions = new Map<string, ContributionEntry>();
  private readonly activeContributions = new Map<string, ContributionEntry>();
  private readonly slotEntries = new Map<string, SlotEntry>();
  private readonly hiddenSlotActions = new Set<string>();
  private readonly settings = new Map<string, SettingEntry>();
  private readonly activeSettings = new Map<string, SettingEntry>();
  private readonly menus = new Set<RuntimeMenu>();
  private readonly modals = new Set<RuntimeModal>();
  private readonly notices = new Set<RuntimeNotice>();
  private readonly dedupedNotices = new Map<string, RuntimeNotice>();
  private readonly noticeContainers = new Map<string, HTMLElement>();
  private readonly headlessLogs: HeadlessUiLogEntry[] = [];
  private sequence = 0;

  constructor(options: RuntimeUiHostOptions = {}) {
    this.slots = options.slots ?? {};
    this.commandRegistry = options.commandRegistry;
    this.defaultWindow = options.defaultWindow;
    this.resolveStorage = options.resolveStorage ?? (() => null);
    this.diagnosticReporter = options.reportDiagnostic ?? (() => undefined);
    this.externalUrlOpener = options.openExternalUrl;
    this.dangerousActionConfirmer = options.confirmDangerousAction;
    this.mountSettingChild = options.mountSettingChild;
    this.unmountSettingChild = options.unmountSettingChild;
    this.noticeLogger = options.logNotice ?? ((entry) => void this.headlessLogs.push(entry));
    this.policy = new RuntimeUiPolicy(this);
  }

  get headlessNoticeLog(): readonly HeadlessUiLogEntry[] {
    return [...this.headlessLogs];
  }

  /** Host-owned preference; plugin contribution updates cannot override it. */
  setActionHidden(slot: UiSlot, globalId: string, hidden: boolean): void {
    const key = `${slot}:${globalId}`;
    if (hidden) this.hiddenSlotActions.add(key);
    else this.hiddenSlotActions.delete(key);
    const entry = this.slotEntries.get(key);
    if (entry?.state === "active") this.renderSlot(entry);
  }

  createService(owner: ResourceOwner, registerResource: UiResourceRegistrar): UiService {
    const registered = new WeakSet<object>();
    const register = <T extends ManagedResource>(resource: T): T => {
      if (registered.has(resource)) return resource;
      try {
        registerResource(resource);
        registered.add(resource);
      } catch (error) {
        void resource.dispose();
        throw error;
      }
      return resource;
    };
    return {
      policy: this.policy,
      menus: {
        createMenu: (context) => register(this.createMenu(owner, context)),
        registerContribution: (point, contribute, options) => {
          const result = this.registerContribution(owner, point, contribute, options);
          if (result.ok) register(result.registration);
          return result;
        },
      },
      modals: {
        open: (definition) => this.openModal(owner, definition, register),
      },
      notices: {
        show: (message, options) => {
          const result = this.showNotice(owner, message, options);
          if (result.ok) register(result.value as NoticeHandle & ManagedResource);
          return result;
        },
      },
      settings: {
        registerSettingTab: (definition) => {
          const result = this.registerSettingTab(owner, definition);
          if (result.ok) register(result.registration);
          return result;
        },
      },
      registerAction: (slot, definition) => {
        const result = this.registerAction(owner, slot, definition);
        if (result.ok) register(result.registration);
        return result;
      },
    };
  }

  registerContribution(
    owner: ResourceOwner,
    point: MenuContributionPoint,
    contribute: (menu: Menu, context: MenuContext) => void,
    options: { readonly section?: string; readonly priority?: number } = {},
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    let priority: number;
    try { priority = normalizePriority(options.priority); }
    catch (error) { return { ok: false, diagnostic: this.invalidUi(owner, point, error) }; }
    const sequence = ++this.sequence;
    const entry: ContributionEntry = {
      key: `ui:menu-contribution:${owner.pluginId}:${sequence}`,
      owner,
      point,
      contribute,
      section: options.section ?? "default",
      priority,
      sequence,
      state: "staged",
    };
    this.contributions.set(entry.key, entry);
    return { ok: true, registration: new ContributionRegistrationImpl(this, entry) };
  }

  createMenu(owner: ResourceOwner, context: MenuContext): RuntimeMenu {
    if (context.window.ownerDocument.defaultView !== context.window.ownerWindow) {
      throw new TypeError("Menu WindowContext has mismatched ownerDocument and ownerWindow");
    }
    const menu = new RuntimeMenu(this, owner, context, ++this.sequence);
    this.menus.add(menu);
    return menu;
  }

  async openModal(
    owner: ResourceOwner,
    definition: ModalDefinition,
    registerResource?: <T extends ManagedResource>(resource: T) => T,
  ): Promise<ServiceResult<ModalController>> {
    if (definition.window.ownerDocument.defaultView !== definition.window.ownerWindow) {
      return {
        ok: false,
        diagnostic: this.reportUiDiagnostic(
          "command-invalid",
          "Modal WindowContext has mismatched ownerDocument and ownerWindow",
          owner,
          "modal",
        ),
      };
    }
    const modal = new RuntimeModal(this, owner, definition, ++this.sequence);
    this.modals.add(modal);
    try {
      registerResource?.(modal);
      await modal.openNow();
      return { ok: true, value: modal };
    } catch (error) {
      await modal.close();
      return {
        ok: false,
        diagnostic: this.reportUiDiagnostic(
          "callback-failed",
          "Modal onOpen callback failed",
          owner,
          String(modal.id),
          error,
        ),
      };
    }
  }

  showNotice(
    owner: ResourceOwner,
    message: string,
    options: NoticeOptions = {},
  ): ServiceResult<NoticeHandle & ManagedResource> {
    const level = options.level ?? "info";
    const window = options.window ?? this.defaultWindow ?? null;
    const key = options.dedupeKey
      ? `${owner.pluginId}:${owner.componentId}:${window?.id ?? "headless"}:${options.dedupeKey}`
      : null;
    const existing = key ? this.dedupedNotices.get(key) : undefined;
    if (existing && !existing.disposed) {
      existing.update(message, options);
      return { ok: true, value: existing };
    }
    const notice = new RuntimeNotice(
      this,
      owner,
      ++this.sequence,
      message,
      level,
      options.dedupeKey,
      window,
      options.durationMs ?? 4_000,
    );
    this.notices.add(notice);
    if (key) this.dedupedNotices.set(key, notice);
    return { ok: true, value: notice };
  }

  registerSettingTab(
    owner: ResourceOwner,
    definition: SettingTabDefinition,
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    const localId = definition.id.trim();
    const globalId = `${owner.pluginId}:${localId}`;
    if (!localId || !definition.name.trim()) {
      return { ok: false, diagnostic: this.invalidUi(owner, globalId, new TypeError("Setting tab id and name are required")) };
    }
    if (this.settings.has(globalId)) {
      return {
        ok: false,
        diagnostic: this.reportUiDiagnostic(
          "registration-conflict",
          `Setting tab '${globalId}' is already registered`,
          owner,
          globalId,
        ),
      };
    }
    const entry: SettingEntry = {
      key: `ui:setting:${globalId}`,
      owner,
      localId,
      globalId,
      definition: Object.freeze({ ...definition }),
      sequence: ++this.sequence,
      state: "staged",
      display: null,
      hidePromise: null,
    };
    this.settings.set(globalId, entry);
    return { ok: true, registration: new SettingRegistrationImpl(this, entry) };
  }

  async displaySettingTab(
    id: string,
    window = this.defaultWindow,
    container?: HTMLElement,
  ): Promise<ServiceResult<HTMLElement>> {
    const entry = this.activeSettings.get(id);
    if (!entry) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("unsupported-operation", `Setting tab '${id}' is unavailable`, undefined, id) };
    }
    if (!window) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("platform-unsupported", "Cannot display settings without a WindowContext", entry.owner, id) };
    }
    const storage = this.resolveStorage(entry.owner);
    if (!storage) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("capability-unsupported", `Setting tab '${id}' has no plugin storage binding`, entry.owner, id) };
    }
    await this.hideSettingTab(id);
    const host = container ?? window.ownerDocument.createElement("section");
    if (host.ownerDocument !== window.ownerDocument) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("command-invalid", "Setting container belongs to another document", entry.owner, id) };
    }
    host.classList.add("nexus-plugin-setting-tab");
    host.dataset.settingTabId = entry.globalId;
    if (!container) window.ownerDocument.body.append(host);
    const snapshot = await storage.loadData();
    const root = snapshot.data && typeof snapshot.data === "object" && !Array.isArray(snapshot.data)
      ? snapshot.data as Readonly<Record<string, unknown>>
      : {};
    const stored = root.settings && typeof root.settings === "object" && !Array.isArray(root.settings)
      ? root.settings as Readonly<Record<string, SettingValue>>
      : {};
    const values: Record<string, SettingValue> = {};
    for (const setting of entry.definition.settings ?? []) {
      values[setting.id] = stored[setting.id] ?? setting.defaultValue;
    }
    const display: SettingDisplay = {
      entry,
      window,
      containerEl: host,
      storage,
      values,
      children: [],
      cleanups: [],
      ownsContainer: container === undefined,
      hidden: false,
    };
    entry.display = display;
    for (const setting of entry.definition.settings ?? []) this.renderSetting(display, setting);
    try {
      await entry.definition.display?.({
        containerEl: host,
        window,
        storage,
        values: Object.freeze({ ...values }),
        addChild: async (child) => {
          let controller: ComponentController | null = null;
          if (this.mountSettingChild) {
            await this.mountSettingChild(entry.owner, child);
          } else {
            const identity: PluginIdentity = Object.freeze({
              id: entry.owner.pluginId,
              name: entry.owner.pluginId,
              version: "unknown",
              source: Object.freeze({
                kind: "development",
                locator: `runtime:${entry.owner.pluginId}`,
              }),
            });
            controller = this.lifecycle.manageOwned(child, identity, {
              pluginId: entry.owner.pluginId,
              componentId: `${entry.owner.componentId}/setting:${entry.localId}:${display.children.length + 1}` as ComponentId,
            });
            await controller.load();
          }
          display.children.push({ child, controller });
          return child;
        },
      });
      return { ok: true, value: host };
    } catch (error) {
      await this.hideSettingTab(id);
      return { ok: false, diagnostic: this.reportUiDiagnostic("callback-failed", `Setting tab '${id}' display callback failed`, entry.owner, id, error) };
    }
  }

  async hideSettingTab(id: string): Promise<void> {
    const entry = this.settings.get(id);
    if (entry?.hidePromise) return entry.hidePromise;
    const display = entry?.display;
    if (!entry || !display || display.hidden) return;
    const hide = (async () => {
      display.hidden = true;
      entry.display = null;
      for (const cleanup of display.cleanups.splice(0).reverse()) {
        try { await cleanup(); }
        catch (error) { this.reportUiDiagnostic("lifecycle-cleanup-failed", `Setting tab '${id}' display cleanup failed`, entry.owner, id, error); }
      }
      for (const { child, controller } of display.children.splice(0).reverse()) {
        try {
          if (this.unmountSettingChild) await this.unmountSettingChild(entry.owner, child);
          else await controller?.unload();
        } catch (error) {
          this.reportUiDiagnostic("lifecycle-cleanup-failed", `Setting tab '${id}' child cleanup failed`, entry.owner, id, error);
        }
      }
      try { await entry.definition.hide?.(); }
      catch (error) { this.reportUiDiagnostic("callback-failed", `Setting tab '${id}' hide callback failed`, entry.owner, id, error); }
      display.containerEl.replaceChildren();
      if (display.ownsContainer) display.containerEl.remove();
    })();
    entry.hidePromise = hide;
    try {
      await hide;
    } finally {
      if (entry.hidePromise === hide) entry.hidePromise = null;
    }
  }

  async setSettingValue(
    tabId: string,
    settingId: string,
    value: SettingValue,
  ): Promise<ServiceResult<void>> {
    const entry = this.activeSettings.get(tabId);
    const display = entry?.display;
    const definition = entry?.definition.settings?.find((item) => item.id === settingId);
    if (!entry || !display || !definition) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("unsupported-operation", `Setting '${tabId}/${settingId}' is not displayed`, entry?.owner, settingId) };
    }
    let validation: string | null = null;
    try { validation = await definition.validate?.(value as never) ?? null; }
    catch (error) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("callback-failed", `Setting '${settingId}' validator failed`, entry.owner, settingId, error) };
    }
    const row = Array.from(
      display.containerEl.querySelectorAll<HTMLElement>("[data-setting-id]"),
    ).find((candidate) => candidate.dataset.settingId === settingId);
    const errorEl = row?.querySelector<HTMLElement>("[data-setting-error]");
    if (validation) {
      if (errorEl) { errorEl.textContent = validation; errorEl.hidden = false; }
      return { ok: false, diagnostic: this.reportUiDiagnostic("command-invalid", validation, entry.owner, settingId) };
    }
    if (errorEl) { errorEl.textContent = ""; errorEl.hidden = true; }
    const nextValues = { ...display.values, [settingId]: value };
    const current = await display.storage.loadData();
    const root = current.data && typeof current.data === "object" && !Array.isArray(current.data)
      ? current.data as Record<string, SettingValue>
      : {};
    const result = await display.storage.saveData({ ...root, settings: nextValues });
    if (!result.ok) return result;
    display.values[settingId] = value;
    return { ok: true, value: undefined };
  }

  registerAction(
    owner: ResourceOwner,
    slot: UiSlot,
    definition: UiActionDefinition,
  ): RegistrationResult<UiSlotRegistration & ManagedResource> {
    const context = this.slots[slot];
    if (!context) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("platform-unsupported", `UI slot '${slot}' is not supported`, owner, slot) };
    }
    if (!hasAccessibleActionName(definition)) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("ui-action-inaccessible", `UI action '${definition.id}' uses an icon without an accessible name`, owner, definition.id) };
    }
    if (typeof definition.action !== "function") {
      return { ok: false, diagnostic: this.reportUiDiagnostic("command-invalid", `UI action '${definition.id}' must define an action callback`, owner, definition.id) };
    }
    if (slot === "command-palette") {
      if (!definition.commandId || !this.commandRegistry) {
        return { ok: false, diagnostic: this.reportUiDiagnostic("command-invalid", "Command palette actions must reference the unified CommandRegistry", owner, definition.id) };
      }
    }
    let priority: number;
    try { priority = normalizePriority(definition.priority); }
    catch (error) { return { ok: false, diagnostic: this.invalidUi(owner, definition.id, error) }; }
    const globalId = `${owner.pluginId}:${definition.id}`;
    if (this.slotEntries.has(`${slot}:${globalId}`)) {
      return { ok: false, diagnostic: this.reportUiDiagnostic("registration-conflict", `UI action '${globalId}' is already registered in '${slot}'`, owner, globalId) };
    }
    const entry: SlotEntry = {
      key: `ui:slot:${slot}:${globalId}`,
      owner,
      slot,
      definition: Object.freeze({ ...definition }),
      globalId,
      priority,
      sequence: ++this.sequence,
      state: "staged",
      element: null,
    };
    this.slotEntries.set(`${slot}:${globalId}`, entry);
    return { ok: true, registration: new SlotRegistrationImpl(this, entry) };
  }

  async listPaletteCommands(
    query: string,
    source: UiActionContext,
  ): Promise<readonly { readonly command: RegisteredCommand; readonly availability: CommandAvailability }[]> {
    if (!this.commandRegistry) return [];
    const normalized = query.trim().toLocaleLowerCase();
    const commands = this.commandRegistry.listCommands().filter((command) =>
      command.showInCommandPalette !== false &&
      (!normalized || `${command.name} ${command.description ?? ""} ${command.id}`.toLocaleLowerCase().includes(normalized)),
    );
    return Promise.all(commands.map(async (command) => ({
      command,
      availability: await this.commandRegistry!.checkCommand(command.id, {
        trigger: "command-palette",
        editor: source.editor,
        sourceId: source.leaf?.id,
      }),
    })));
  }

  executePaletteCommand(id: string, source: UiActionContext): Promise<CommandExecutionResult> {
    if (!this.commandRegistry) {
      return Promise.resolve({
        ok: false,
        diagnostic: this.reportUiDiagnostic("platform-unsupported", "Command palette has no CommandRegistry", undefined, id),
      });
    }
    return this.commandRegistry.executeCommand(id, {
      trigger: "command-palette",
      editor: source.editor,
      sourceId: source.leaf?.id,
    });
  }

  activateContribution(entry: ContributionEntry): void {
    if (entry.state !== "staged") return;
    entry.state = "active";
    this.activeContributions.set(entry.key, entry);
  }
  quiesceContribution(entry: ContributionEntry): void {
    if (entry.state !== "staged" && entry.state !== "active") return;
    entry.state = "quiescing";
    this.activeContributions.delete(entry.key);
  }
  disposeContribution(entry: ContributionEntry): Promise<void> {
    this.quiesceContribution(entry);
    entry.state = "disposed";
    this.activeContributions.delete(entry.key);
    this.contributions.delete(entry.key);
    return Promise.resolve();
  }
  collectMenuContributions(menu: RuntimeMenu): void {
    const point = pointForContext(menu.context);
    if (!point) return;
    const entries = [...this.activeContributions.values()]
      .filter((entry) => entry.state === "active" && entry.point === point)
      .sort((left, right) => left.section.localeCompare(right.section) || right.priority - left.priority || left.sequence - right.sequence);
    for (const entry of entries) {
      try { menu.collectContribution(entry.section, entry.priority, entry.contribute); }
      catch (error) { this.reportUiDiagnostic("callback-failed", `Menu contribution '${entry.key}' failed`, entry.owner, entry.key, error); }
    }
  }

  activateSlot(entry: SlotEntry): void {
    if (entry.state !== "staged") return;
    entry.state = "active";
    this.renderSlot(entry);
  }
  quiesceSlot(entry: SlotEntry): void {
    if (entry.state !== "staged" && entry.state !== "active") return;
    entry.state = "quiescing";
    entry.element?.remove();
    entry.element = null;
  }
  disposeSlot(entry: SlotEntry): Promise<void> {
    this.quiesceSlot(entry);
    entry.state = "disposed";
    this.slotEntries.delete(`${entry.slot}:${entry.globalId}`);
    return Promise.resolve();
  }

  updateSlot(
    entry: SlotEntry,
    patch: Partial<Omit<UiActionDefinition, "id">>,
  ): ServiceResult<void> {
    if (entry.state === "quiescing" || entry.state === "disposed") {
      return {
        ok: false,
        diagnostic: this.reportUiDiagnostic(
          "registration-owner-quiescing",
          `UI action '${entry.globalId}' is no longer active`,
          entry.owner,
          entry.globalId,
        ),
      };
    }
    const definition = Object.freeze({
      ...entry.definition,
      ...patch,
      id: entry.definition.id,
    });
    if (!hasAccessibleActionName(definition)) {
      return {
        ok: false,
        diagnostic: this.reportUiDiagnostic(
          "ui-action-inaccessible",
          `UI action '${definition.id}' uses an icon without an accessible name`,
          entry.owner,
          definition.id,
        ),
      };
    }
    if (typeof definition.action !== "function") {
      return {
        ok: false,
        diagnostic: this.reportUiDiagnostic(
          "command-invalid",
          `UI action '${definition.id}' must define an action callback`,
          entry.owner,
          definition.id,
        ),
      };
    }
    if (entry.slot === "command-palette" && (!definition.commandId || !this.commandRegistry)) {
      return {
        ok: false,
        diagnostic: this.reportUiDiagnostic(
          "command-invalid",
          "Command palette actions must reference the unified CommandRegistry",
          entry.owner,
          definition.id,
        ),
      };
    }
    let priority: number;
    try { priority = normalizePriority(definition.priority); }
    catch (error) {
      return { ok: false, diagnostic: this.invalidUi(entry.owner, definition.id, error) };
    }

    entry.definition = definition;
    entry.priority = priority;
    if (entry.state === "active") {
      this.renderSlot(entry);
    }
    return { ok: true, value: undefined };
  }

  activateSetting(entry: SettingEntry): void {
    if (entry.state !== "staged") return;
    entry.state = "active";
    this.activeSettings.set(entry.globalId, entry);
  }
  quiesceSetting(entry: SettingEntry): void {
    if (entry.state !== "staged" && entry.state !== "active") return;
    entry.state = "quiescing";
    this.activeSettings.delete(entry.globalId);
    void this.hideSettingTab(entry.globalId);
  }
  async disposeSetting(entry: SettingEntry): Promise<void> {
    this.quiesceSetting(entry);
    await this.hideSettingTab(entry.globalId);
    entry.state = "disposed";
    this.activeSettings.delete(entry.globalId);
    this.settings.delete(entry.globalId);
  }

  removeMenu(menu: RuntimeMenu): void { this.menus.delete(menu); }
  removeModal(modal: RuntimeModal): void { this.modals.delete(modal); }
  removeNotice(notice: RuntimeNotice): void {
    this.notices.delete(notice);
    for (const [key, value] of this.dedupedNotices) if (value === notice) this.dedupedNotices.delete(key);
  }

  noticeContainer(window: WindowContext): HTMLElement {
    const existing = this.noticeContainers.get(window.id);
    if (existing?.isConnected) return existing;
    const element = window.ownerDocument.createElement("div");
    element.className = "nexus-plugin-notices";
    element.setAttribute("aria-label", "Notifications");
    window.ownerDocument.body.append(element);
    this.noticeContainers.set(window.id, element);
    return element;
  }

  logHeadlessNotice(entry: HeadlessUiLogEntry): void { this.noticeLogger(entry); }

  reportUiDiagnostic(
    code: NexusDiagnostic["code"],
    message: string,
    owner?: ResourceOwner,
    resourceId?: string,
    error?: unknown,
  ): NexusDiagnostic {
    const diagnostic: NexusDiagnostic = {
      code,
      severity: "error",
      phase: code === "callback-failed" ? "callback" : "runtime",
      message,
      ...(owner ? { plugin: { id: owner.pluginId, version: "unknown" } } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(error === undefined ? {} : { cause: cause(error) }),
    };
    this.diagnosticReporter(diagnostic);
    return diagnostic;
  }

  private invalidUi(owner: ResourceOwner, resourceId: string, error: unknown): NexusDiagnostic {
    return this.reportUiDiagnostic("command-invalid", error instanceof Error ? error.message : String(error), owner, resourceId, error);
  }

  private renderSlot(entry: SlotEntry): void {
    const slot = this.slots[entry.slot];
    if (!slot || entry.state !== "active") return;
    const definition = entry.definition;
    if (
      this.hiddenSlotActions.has(`${entry.slot}:${entry.globalId}`) ||
      !this.evaluateSlotPredicate(entry, definition, "visible", true)
    ) {
      entry.element?.remove();
      entry.element = null;
      return;
    }
    const document = slot.window.ownerDocument;
    const element = entry.element ?? document.createElement("button");
    if (!entry.element) {
      element.type = "button";
      element.dataset.uiActionId = entry.globalId;
      element.dataset.uiSlot = entry.slot;
      element.addEventListener("click", () => void this.invokeSlotAction(entry, slot.actionContext));
    }
    const name = accessibleName(definition) ?? definition.id;
    element.textContent = definition.label ?? name;
    element.setAttribute("aria-label", name);
    element.title = definition.tooltip ?? "";
    const disabled = this.evaluateSlotPredicate(entry, definition, "disabled", false);
    element.toggleAttribute("aria-disabled", disabled);
    element.disabled = disabled;
    if (definition.dangerous) element.dataset.dangerous = "true";
    else delete element.dataset.dangerous;
    const siblings = Array.from(slot.containerEl.children).map((child) =>
      [...this.slotEntries.values()].find((candidate) => candidate.element === child),
    ).filter((candidate): candidate is SlotEntry => Boolean(candidate));
    const before = siblings.find((candidate) =>
      candidate.priority < entry.priority ||
      (candidate.priority === entry.priority && candidate.sequence > entry.sequence),
    )?.element ?? null;
    const restoreFocus = document.activeElement === element;
    slot.containerEl.insertBefore(element, before);
    if (restoreFocus) element.focus({ preventScroll: true });
    entry.element = element;
  }

  private async invokeSlotAction(entry: SlotEntry, context: UiActionContext): Promise<void> {
    const definition = entry.definition;
    if (
      entry.state !== "active" ||
      !this.evaluateSlotPredicate(entry, definition, "visible", true) ||
      this.evaluateSlotPredicate(entry, definition, "disabled", false)
    ) return;
    try {
      if (definition.dangerous) {
        const allowed = await this.policy.confirmDangerousAction({
          title: accessibleName(definition) ?? definition.id,
          message: "This plugin action is marked as dangerous.",
          window: context.window,
        });
        if (!allowed) return;
        if (
          entry.state !== "active" ||
          entry.definition !== definition ||
          !this.evaluateSlotPredicate(entry, definition, "visible", true) ||
          this.evaluateSlotPredicate(entry, definition, "disabled", false)
        ) return;
      }
      if (entry.slot === "command-palette" && definition.commandId) {
        await this.executePaletteCommand(definition.commandId, context);
      } else {
        await definition.action(context);
      }
    } catch (error) {
      this.reportUiDiagnostic("callback-failed", `UI action '${entry.globalId}' failed`, entry.owner, entry.globalId, error);
    }
  }

  private evaluateSlotPredicate(
    entry: SlotEntry,
    definition: UiActionDefinition,
    predicate: "visible" | "disabled",
    fallback: boolean,
  ): boolean {
    try {
      return definition[predicate]?.() ?? fallback;
    } catch (error) {
      this.reportUiDiagnostic(
        "callback-failed",
        `UI action '${entry.globalId}' ${predicate} predicate failed`,
        entry.owner,
        entry.globalId,
        error,
      );
      return predicate === "disabled";
    }
  }

  private renderSetting(display: SettingDisplay, definition: SettingDefinition): void {
    const document = display.window.ownerDocument;
    const values = display.values;
    if (!this.evaluateSettingPredicate(display, definition, "visible", true)) return;
    const row = document.createElement("div");
    row.className = "nexus-plugin-setting";
    row.dataset.settingId = definition.id;
    const label = document.createElement("label");
    label.textContent = definition.name;
    const description = document.createElement("p");
    description.textContent = definition.description ?? "";
    description.hidden = !definition.description;
    const error = document.createElement("p");
    error.dataset.settingError = "true";
    error.setAttribute("role", "alert");
    error.hidden = true;
    const control = this.createSettingControl(display, definition);
    const controlId = `setting-${display.entry.sequence}-${definition.id}`;
    control.id = controlId;
    label.htmlFor = controlId;
    control.toggleAttribute("disabled", this.evaluateSettingPredicate(display, definition, "disabled", false));
    row.append(label, description, control, error);
    display.containerEl.append(row);
  }

  private createSettingControl(display: SettingDisplay, definition: SettingDefinition): HTMLElement {
    const document = display.window.ownerDocument;
    const value = display.values[definition.id] ?? definition.defaultValue;
    let control: HTMLInputElement | HTMLSelectElement | HTMLButtonElement;
    if (definition.type === "select") {
      const select = document.createElement("select");
      for (const optionDefinition of definition.options) {
        const option = document.createElement("option");
        option.value = optionDefinition.value;
        option.textContent = optionDefinition.label;
        select.append(option);
      }
      select.value = String(value);
      control = select;
    } else if (definition.type === "action") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = definition.actionLabel;
      if (definition.dangerous) button.dataset.dangerous = "true";
      const listener = () => void this.invokeSettingAction(display, definition);
      button.addEventListener("click", listener);
      display.cleanups.push(() => button.removeEventListener("click", listener));
      return button;
    } else {
      const input = document.createElement("input");
      input.type = definition.type === "toggle"
        ? "checkbox"
        : definition.type === "color"
          ? "color"
          : definition.type === "slider"
            ? "range"
            : definition.type === "number"
              ? "number"
              : "text";
      if (definition.type === "toggle") input.checked = Boolean(value);
      else input.value = value === null ? "" : String(value);
      if (definition.type === "text" && definition.placeholder) input.placeholder = definition.placeholder;
      if (definition.type === "number" || definition.type === "slider") {
        if (definition.min !== undefined) input.min = String(definition.min);
        if (definition.max !== undefined) input.max = String(definition.max);
        if (definition.step !== undefined) input.step = String(definition.step);
      }
      control = input;
    }
    const listener = () => {
      let next: SettingValue;
      if (control.tagName === "INPUT" && (control as HTMLInputElement).type === "checkbox") next = (control as HTMLInputElement).checked;
      else if (definition.type === "number" || definition.type === "slider") next = Number(control.value);
      else if (definition.type === "file" || definition.type === "folder") next = control.value || null;
      else next = control.value;
      void this.setSettingValue(display.entry.globalId, definition.id, next);
    };
    control.addEventListener("change", listener);
    display.cleanups.push(() => control.removeEventListener("change", listener));
    return control;
  }

  private async invokeSettingAction(
    display: SettingDisplay,
    definition: Extract<SettingDefinition, { readonly type: "action" }>,
  ): Promise<void> {
    if (!this.isSettingDisplayActive(display)) return;
    try {
      if (definition.dangerous) {
        const allowed = await this.policy.confirmDangerousAction({
          title: definition.actionLabel,
          message: definition.name,
          window: display.window,
        });
        if (!allowed || !this.isSettingDisplayActive(display)) return;
      }
      await definition.action();
    } catch (error) {
      this.reportUiDiagnostic(
        "callback-failed",
        `Setting action '${display.entry.globalId}/${definition.id}' failed`,
        display.entry.owner,
        definition.id,
        error,
      );
    }
  }

  private evaluateSettingPredicate(
    display: SettingDisplay,
    definition: SettingDefinition,
    predicate: "visible" | "disabled",
    fallback: boolean,
  ): boolean {
    try {
      return definition[predicate]?.(display.values) ?? fallback;
    } catch (error) {
      this.reportUiDiagnostic(
        "callback-failed",
        `Setting '${display.entry.globalId}/${definition.id}' ${predicate} predicate failed`,
        display.entry.owner,
        definition.id,
        error,
      );
      return predicate === "disabled";
    }
  }

  private isSettingDisplayActive(display: SettingDisplay): boolean {
    return !display.hidden && display.entry.state === "active" && display.entry.display === display;
  }
}

/** Creates a WindowContext without consulting global window/document. */
export function createWindowContext(id: string, ownerDocument: Document): WindowContext {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new TypeError("The supplied Document has no defaultView");
  return Object.freeze({ id: id as WindowContext["id"], ownerDocument, ownerWindow });
}
