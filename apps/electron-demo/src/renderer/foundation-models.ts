export type FoundationModelsBridge = Window["nexusDemo"]["foundationModels"];
export type NativeAvailability = Awaited<ReturnType<FoundationModelsBridge["getAvailability"]>>;

export const unavailableFoundationModels: NativeAvailability = {
  available: false,
  platform: "macos",
  minimumOS: "26.0",
  reason: "model-unavailable",
};

export function createUnavailableFoundationModelsBridge(): FoundationModelsBridge {
  return {
    async getAvailability() {
      return unavailableFoundationModels;
    },
    async suggest() {
      return null;
    },
    async cancelSuggestion() {},
  };
}

export function getWindowFoundationModelsBridge(): FoundationModelsBridge | null {
  const maybeWindow = window as Partial<Window>;
  return maybeWindow.nexusDemo?.foundationModels ?? null;
}
