export type ProductViewSurface = "outline" | "backlinks";
export type ProductDialogSurface = "settings";
export type ProductMenuSurface = "vault-context-menu";
export type ProductUiSurface =
  | ProductViewSurface
  | ProductDialogSurface
  | ProductMenuSurface;

export type ProductUiKind = "view" | "dialog" | "menu";

export const ELECTRON_PRODUCT_UI_SURFACES = Object.freeze({
  outline: "view",
  backlinks: "view",
  settings: "dialog",
  "vault-context-menu": "menu",
} satisfies Readonly<Record<ProductUiSurface, ProductUiKind>>);

export interface ProductUiResource {
  readonly element: HTMLElement;
  destroy(): void;
}

export interface ProductViewResource extends ProductUiResource {
  /** Lets a mounted resource suspend work without destroying its cached DOM. */
  setVisible?(visible: boolean): void;
  update?(): void;
  refresh?(): void;
}

export interface ProductViewMount {
  readonly containerEl: HTMLElement;
  readonly before?: ChildNode | null;
}

export interface ProductUiRegistration {
  readonly surface: ProductUiSurface;
  readonly kind: ProductUiKind;
  readonly element: HTMLElement;
  readonly disposed: boolean;
  setDisposeObserver(observer: () => void): void;
  dispose(): void;
}

export interface ProductViewRegistration extends ProductUiRegistration {
  readonly surface: ProductViewSurface;
  readonly kind: "view";
  readonly visible: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
}

interface RegistrationState {
  readonly surface: ProductUiSurface;
  readonly kind: ProductUiKind;
  readonly resource: ProductUiResource;
  disposed: boolean;
  registration?: ProductUiRegistration;
  disposeObserver?: () => void;
}

const PRODUCT_OWNER = "electron-host";

function isPluginActionContainer(element: HTMLElement): boolean {
  return element.matches("[data-plugin-slot], [data-ui-action-id]") ||
    element.closest("[data-plugin-slot], [data-ui-action-id]") !== null;
}

/**
 * Owns Electron product chrome separately from plugin action slots.
 *
 * Outline/backlinks are host views, settings is a host dialog and the Vault
 * context menu is a host menu. None of them is a `UiSlot` contribution.
 */
export class ElectronProductUiOwner {
  private readonly registrations = new Map<ProductUiSurface, RegistrationState>();
  private readonly registrationOrder: RegistrationState[] = [];
  private destroyed = false;

  constructor(readonly ownerDocument: Document) {}

  get size(): number {
    return this.registrations.size;
  }

  has(surface: ProductUiSurface): boolean {
    return this.registrations.has(surface);
  }

  registerView(
    surface: ProductViewSurface,
    resource: ProductViewResource,
    mount: ProductViewMount,
  ): ProductViewRegistration {
    this.assertCanRegister(surface, "view", resource, mount.containerEl);
    const state = this.track(surface, "view", resource);
    mount.containerEl.insertBefore(resource.element, mount.before ?? null);
    resource.setVisible?.(!resource.element.hidden);

    const registration = this.createRegistration(state) as ProductViewRegistration & {
      visible: boolean;
      show(): void;
      hide(): void;
      toggle(): void;
    };
    Object.defineProperties(registration, {
      visible: {
        enumerable: true,
        get: () => !state.disposed && !resource.element.hidden,
      },
    });
    registration.show = () => {
      if (state.disposed || !resource.element.hidden) return;
      resource.element.hidden = false;
      if (resource.setVisible) resource.setVisible(true);
      else {
        resource.update?.();
        resource.refresh?.();
      }
    };
    registration.hide = () => {
      if (state.disposed || resource.element.hidden) return;
      resource.element.hidden = true;
      resource.setVisible?.(false);
    };
    registration.toggle = () => {
      if (resource.element.hidden) registration.show();
      else registration.hide();
    };
    return registration;
  }

  openDialog(
    surface: ProductDialogSurface,
    create: () => ProductUiResource,
  ): ProductUiRegistration {
    this.assertActive();
    const current = this.registrations.get(surface);
    if (current && !current.disposed && current.resource.element.isConnected) {
      current.resource.element.focus();
      return current.registration ?? this.createRegistration(current);
    }
    if (current) this.disposeState(current);

    const resource = create();
    this.assertCanRegister(surface, "dialog", resource);
    return this.createRegistration(this.track(surface, "dialog", resource));
  }

  replaceMenu(
    surface: ProductMenuSurface,
    create: () => ProductUiResource,
  ): ProductUiRegistration {
    this.assertActive();
    const current = this.registrations.get(surface);
    if (current) this.disposeState(current);

    const resource = create();
    this.assertCanRegister(surface, "menu", resource);
    return this.createRegistration(this.track(surface, "menu", resource));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const errors: unknown[] = [];
    for (const state of [...this.registrationOrder].reverse()) {
      try {
        this.disposeState(state);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Electron product UI cleanup was not clean");
    }
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("Electron product UI owner has been destroyed");
  }

  private assertCanRegister(
    surface: ProductUiSurface,
    kind: ProductUiKind,
    resource: ProductUiResource,
    mountContainer?: HTMLElement,
  ): void {
    this.assertActive();
    if (ELECTRON_PRODUCT_UI_SURFACES[surface] !== kind) {
      throw new Error(`Product UI surface '${surface}' does not accept ${kind} resources`);
    }
    if (this.registrations.has(surface)) {
      throw new Error(`Product UI surface '${surface}' already has an owner`);
    }
    if (resource.element.ownerDocument !== this.ownerDocument) {
      throw new Error(`Product UI surface '${surface}' belongs to another window`);
    }
    if (isPluginActionContainer(resource.element) ||
      (mountContainer && isPluginActionContainer(mountContainer))) {
      throw new Error(`Product UI surface '${surface}' cannot mount inside a plugin action slot`);
    }
  }

  private track(
    surface: ProductUiSurface,
    kind: ProductUiKind,
    resource: ProductUiResource,
  ): RegistrationState {
    const state: RegistrationState = { surface, kind, resource, disposed: false };
    resource.element.dataset.nexusProductSurface = surface;
    resource.element.dataset.nexusUiOwner = PRODUCT_OWNER;
    resource.element.dataset.nexusProductKind = kind;
    this.registrations.set(surface, state);
    this.registrationOrder.push(state);
    return state;
  }

  private createRegistration(state: RegistrationState): ProductUiRegistration {
    if (state.registration) return state.registration;
    const registration: ProductUiRegistration = {
      surface: state.surface,
      kind: state.kind,
      element: state.resource.element,
      get disposed() {
        return state.disposed;
      },
      setDisposeObserver(observer) {
        state.disposeObserver = observer;
      },
      dispose: () => this.disposeState(state),
    };
    state.registration = registration;
    return registration;
  }

  private disposeState(state: RegistrationState): void {
    if (state.disposed) return;
    state.disposed = true;
    if (this.registrations.get(state.surface) === state) {
      this.registrations.delete(state.surface);
    }
    try {
      state.resource.destroy();
    } finally {
      state.disposeObserver?.();
      state.disposeObserver = undefined;
    }
  }
}
