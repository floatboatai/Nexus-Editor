declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  export interface GfmPlugin {
    (service: TurndownService): void;
  }

  export const gfm: GfmPlugin;
  export const tables: GfmPlugin;
  export const strikethrough: GfmPlugin;
  export const taskListItems: GfmPlugin;
}
