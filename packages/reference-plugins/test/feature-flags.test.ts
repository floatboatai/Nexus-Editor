import { BlockDragLifecyclePlugin } from "@floatboat/nexus-plugin-block-drag";
import {
  SlashLifecyclePlugin,
} from "@floatboat/nexus-plugin-slash";
import {
  ToolbarLifecyclePlugin,
} from "@floatboat/nexus-plugin-toolbar";
import {
  WordCountLifecyclePlugin,
} from "@floatboat/nexus-plugin-wordcount";
import { describe, expect, it } from "vitest";

import {
  bundledReferencePlugins,
  createReferencePluginBootPlan,
  type ReferencePluginBootPlan,
  type ReferencePluginFeatureFlags,
} from "../src";

const BOOLEAN_VALUES = [false, true] as const;

const FEATURE_FLAG_CASES = BOOLEAN_VALUES.flatMap((pluginPlatform) =>
  BOOLEAN_VALUES.flatMap((toolbar) =>
    BOOLEAN_VALUES.flatMap((slashMenu) =>
      BOOLEAN_VALUES.flatMap((wordCount) => BOOLEAN_VALUES.map((blockDrag) => ({
        label: [
          `pluginPlatform=${pluginPlatform}`,
          `toolbar=${toolbar}`,
          `slashMenu=${slashMenu}`,
          `wordCount=${wordCount}`,
          `blockDrag=${blockDrag}`,
        ].join(", "),
        flags: {
          pluginPlatform,
          toolbar,
          slashMenu,
          wordCount,
          blockDrag,
        } satisfies ReferencePluginFeatureFlags,
      }))),
    ),
  ),
);

function countOwners(
  plan: ReferencePluginBootPlan,
  legacyOwner: boolean,
  RuntimePlugin: (typeof plan.runtimePlugins)[number],
): number {
  return Number(legacyOwner) + Number(plan.runtimePlugins.includes(RuntimePlugin));
}

describe("createReferencePluginBootPlan feature flags", () => {
  it("pairs every runtime constructor with exactly one bundled manifest id", () => {
    const plan = createReferencePluginBootPlan({
      pluginPlatform: true,
      toolbar: true,
      slashMenu: true,
      wordCount: true,
      blockDrag: true,
    });

    const pairs = plan.runtimePlugins.map((Plugin) =>
      bundledReferencePlugins.filter((entry) => entry.Plugin === Plugin),
    );
    expect(pairs.every((matches) => matches.length === 1)).toBe(true);
    expect(pairs.map(([entry]) => entry?.manifest.id)).toEqual([
      "toolbar",
      "slash-menu",
      "wordcount",
      "block-drag",
    ]);
  });

  it.each(FEATURE_FLAG_CASES)(
    "$label selects exactly one legacy or runtime owner per enabled feature",
    ({ flags }) => {
      const plan = createReferencePluginBootPlan(flags);

      expect(plan.mode).toBe(flags.pluginPlatform ? "runtime" : "legacy");
      expect(
        countOwners(plan, plan.legacyUi.toolbar, ToolbarLifecyclePlugin),
      ).toBe(Number(flags.toolbar));
      expect(
        countOwners(plan, plan.legacyUi.slashMenu, SlashLifecyclePlugin),
      ).toBe(Number(flags.slashMenu));
      expect(
        countOwners(plan, plan.legacyUi.wordCount, WordCountLifecyclePlugin),
      ).toBe(Number(flags.wordCount));

      expect(
        countOwners(
          plan,
          plan.editorContributions.some((plugin) => plugin.name === "plugin-block-drag"),
          BlockDragLifecyclePlugin,
        ),
      ).toBe(Number(flags.blockDrag));

      if (flags.pluginPlatform) {
        expect(plan.runtimePlugins).toEqual([
          ...(flags.toolbar ? [ToolbarLifecyclePlugin] : []),
          ...(flags.slashMenu ? [SlashLifecyclePlugin] : []),
          ...(flags.wordCount ? [WordCountLifecyclePlugin] : []),
          ...(flags.blockDrag ? [BlockDragLifecyclePlugin] : []),
        ]);
        expect(plan.legacyUi).toEqual({
          toolbar: false,
          slashMenu: false,
          wordCount: false,
        });
        expect(plan.legacyWordCount).toBeNull();
        return;
      }

      expect(plan.runtimePlugins).toEqual([]);
      expect(plan.legacyUi).toEqual({
        toolbar: flags.toolbar,
        slashMenu: flags.slashMenu,
        wordCount: flags.wordCount,
      });
      expect(Boolean(plan.legacyWordCount)).toBe(flags.wordCount);
      if (plan.legacyWordCount) {
        expect(plan.editorContributions).toContain(plan.legacyWordCount);
      }
      expect(plan.editorContributions.map((plugin) => plugin.name)).toEqual([
        ...(flags.toolbar ? ["plugin-toolbar"] : []),
        ...(flags.wordCount ? ["plugin-wordcount"] : []),
        ...(flags.blockDrag ? ["plugin-block-drag"] : []),
      ]);
    },
  );

  it.each(FEATURE_FLAG_CASES)(
    "$label only exposes the runtime slash catalogue when toolbar and slash menu are enabled",
    ({ flags }) => {
      const plan = createReferencePluginBootPlan(flags);
      const shouldExposeCatalogue =
        flags.pluginPlatform && flags.toolbar && flags.slashMenu;

      expect(plan.editorContributions).toHaveLength(
        flags.pluginPlatform
          ? Number(shouldExposeCatalogue)
          : Number(flags.toolbar) + Number(flags.wordCount) + Number(flags.blockDrag),
      );

      if (!flags.pluginPlatform || !shouldExposeCatalogue) return;

      const [catalogue] = plan.editorContributions;
      expect(catalogue?.name).toBe("plugin-toolbar-runtime-slash-catalogue");
      expect(catalogue?.slashCommands?.length).toBeGreaterThan(0);
      expect(
        catalogue?.slashCommands?.every((command) =>
          command.id.startsWith("toolbar:"),
        ),
      ).toBe(true);
      expect(
        catalogue?.slashCommands?.every((command) => command.run === undefined),
      ).toBe(true);
    },
  );

  it.each(FEATURE_FLAG_CASES)(
    "$label can be constructed repeatedly without sharing plan-owned mutable state",
    ({ flags }) => {
      const first = createReferencePluginBootPlan(flags);
      const second = createReferencePluginBootPlan(flags);

      expect(first).not.toBe(second);
      expect(first.editorContributions).not.toBe(second.editorContributions);
      expect(first.runtimePlugins).not.toBe(second.runtimePlugins);
      expect(first.legacyUi).not.toBe(second.legacyUi);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.editorContributions)).toBe(true);
      expect(Object.isFrozen(first.runtimePlugins)).toBe(true);
      expect(Object.isFrozen(first.legacyUi)).toBe(true);

      for (const [index, contribution] of first.editorContributions.entries()) {
        expect(contribution).not.toBe(second.editorContributions[index]);
      }

      if (first.legacyWordCount && second.legacyWordCount) {
        expect(first.legacyWordCount).not.toBe(second.legacyWordCount);
      } else {
        expect(first.legacyWordCount).toBeNull();
        expect(second.legacyWordCount).toBeNull();
      }
    },
  );
});
