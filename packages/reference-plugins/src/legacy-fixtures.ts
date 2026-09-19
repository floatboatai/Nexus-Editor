import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createMathPlugin } from "@floatboat/nexus-plugin-math";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import { createVimPlugin } from "@floatboat/nexus-plugin-vim";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createWikilinksPlugin, type NexusPlugin } from "@floatboat/nexus-core";

/**
 * 旧版参考插件支持的标识符类型。
 * 用于区分不同插件的测试桩。
 */
export type LegacyReferencePluginId =
  | "history"
  | "search"
  | "vim"
  | "gfm"
  | "math"
  | "wikilinks";

/**
 * 旧版参考插件测试桩的数据结构。
 * 包含插件标识、创建函数以及预期的贡献数量。
 */
export interface LegacyReferenceFixture {
  /** 插件标识符 */
  readonly id: LegacyReferencePluginId;
  /** 插件内部ID */
  readonly pluginId: string;
  /** 用于创建插件实例的工厂函数 */
  readonly create: () => NexusPlugin;
  /** 预期该插件应该贡献的各类功能的基准数量 */
  readonly expected: Readonly<{
    commands: number;
    shortcuts: number;
    handlers: number;
    cmExtensions: number;
    remarkPlugins: number;
    widgets: number;
  }>;
}

/**
 * 为每个受支持的旧版插件提供编译期和运行时的测试数据（Fixtures）。
 * 用于在测试中验证插件功能是否正确注册。
 */
export const legacyReferenceFixtures: readonly LegacyReferenceFixture[] = Object.freeze([
  {
    // 历史记录插件
    id: "history",
    pluginId: "legacy-history",
    create: createHistoryPlugin,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 2, remarkPlugins: 0, widgets: 0 },
  },
  {
    // 搜索插件（注意：此处禁用了历史记录功能）
    id: "search",
    pluginId: "legacy-search",
    create: () => createSearchPlugin({ history: false }),
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 4, remarkPlugins: 0, widgets: 0 },
  },
  {
    // Vim 模式插件
    id: "vim",
    pluginId: "legacy-vim",
    create: createVimPlugin,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 1, remarkPlugins: 0, widgets: 0 },
  },
  {
    // GitHub Flavored Markdown (GFM) 预设插件
    id: "gfm",
    pluginId: "legacy-gfm",
    create: createGfmPreset,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 0, remarkPlugins: 1, widgets: 0 },
  },
  {
    // 数学公式插件
    id: "math",
    pluginId: "legacy-math",
    create: createMathPlugin,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 0, remarkPlugins: 1, widgets: 2 },
  },
  {
    // Wiki 链接插件
    id: "wikilinks",
    pluginId: "legacy-wikilinks",
    create: createWikilinksPlugin,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 3, remarkPlugins: 0, widgets: 0 },
  },
]);

/**
 * 统计一个 NexusPlugin 实例对编辑器的各项贡献数量。
 * 遍历插件的命令、快捷键、事件处理器、CodeMirror扩展、Remark插件和Widget。
 * 
 * @param plugin - 需要被统计的 NexusPlugin 实例。
 * @returns 一个包含各项贡献数量的冻结对象。
 */
export function countLegacyContributions(plugin: NexusPlugin): LegacyReferenceFixture["expected"] {
  return Object.freeze({
    commands: plugin.commands?.length ?? 0,
    shortcuts: plugin.shortcuts?.length ?? 0,
    handlers: Object.values(plugin.handlers ?? {}).filter(Boolean).length,
    cmExtensions: plugin.cmExtensions?.length ?? 0,
    remarkPlugins: plugin.remarkPlugins?.length ?? 0,
    widgets: plugin.widgets?.length ?? 0,
  });
}