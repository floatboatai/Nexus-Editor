export interface NativeAvailability {
  available: boolean;
  platform: "macos";
  minimumOS: "26.0";
  reason?: "unsupported-os" | "unsupported-architecture" | "apple-intelligence-unavailable" | "model-unavailable";
}

export interface NativeFoundationModels {
  getAvailability(): Promise<NativeAvailability>;
  suggest(input: string): Promise<string | null>;
  cancelSuggestion?: () => Promise<void> | void;
  dispose(): void;
}

export interface FoundationModelsBridge {
  getAvailability(): Promise<NativeAvailability>;
  suggest(input: string): Promise<string | null>;
  cancelSuggestion(): Promise<void>;
}

export interface FoundationModelsMainBridge extends FoundationModelsBridge {
  dispose(): void;
}

export interface FoundationModelsBridgeOptions {
  native: NativeFoundationModels | null;
}

const unavailableAvailability: NativeAvailability = {
  available: false,
  platform: "macos",
  minimumOS: "26.0",
  reason: "model-unavailable",
};

export function createFoundationModelsBridge(options: FoundationModelsBridgeOptions): FoundationModelsMainBridge {
  const native = options.native;

  if (!native) {
    return {
      async getAvailability() {
        return unavailableAvailability;
      },
      async suggest() {
        return null;
      },
      async cancelSuggestion() {},
      dispose() {},
    };
  }

  let disposed = false;
  return {
    getAvailability() {
      return native.getAvailability();
    },
    suggest(input: string) {
      return native.suggest(input);
    },
    async cancelSuggestion() {
      await native.cancelSuggestion?.();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      native.dispose();
    },
  };
}
