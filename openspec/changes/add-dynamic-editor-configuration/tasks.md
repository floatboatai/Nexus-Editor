# 实施任务清单 (Implementation Tasks)

- [x] 1. Core 层类型与 Compartment 基础设施 (`packages/core`) <!-- id: 1-core-types-compartments -->
  - [x] 在 `packages/core/src/types.ts` 中声明 `DynamicEditorConfig` 接口并在 `EditorAPI` 中添加 `reconfigure` 及 Setter 方法定义
  - [x] 在 `packages/core/src/editor.ts` 中为 `readOnly`, `tabSize`, `direction`, `indentGuides` 实例化 `Compartment`
  - [x] 在 `packages/core/src/editor.ts` 中实现 `reconfigure(config: DynamicEditorConfig)` 批量派发
  - [x] 在 `packages/core/src/editor.ts` 中实现 `setReadOnly`, `setTabSize`, `setDirection`, `setIndentGuides`, `setLocale`
  - [x] 编写 `packages/core/test/reconfigure.test.ts` 单元测试，验证各配置动态更新及单事务合并效果
- [x] 2. Vue 3 框架响应式绑定 (`packages/vue`) <!-- id: 2-vue-integration -->
  - [x] 在 `packages/vue/src/use-editor.ts` 中添加对动态配置 Props 的 `watch` 监听
  - [x] 联动 `editor.value.reconfigure` 触发动态更新
  - [x] 编写 `packages/vue/test/editor-reactivity.test.ts` 单元测试，验证组件 Props 变化时编辑器状态即时响应
- [x] 3. React 框架绑定与依赖同步 (`packages/react`) <!-- id: 3-react-integration -->
  - [x] 在 `packages/react/src/use-editor.ts` 中添加对动态配置依赖的 `useEffect`
  - [x] 编写 `packages/react/test/editor-reactivity.test.tsx` 单元测试，验证 React 组件重渲染时的配置同步
- [x] 4. 全局质量验证与规范收尾 <!-- id: 4-verification-docs -->
  - [x] 运行全工作区类型检查 (`pnpm typecheck`) 与 API 一致性检查 (`pnpm check:api`)
  - [x] 运行全工作区单元测试 (`pnpm test`)，保证 100% 通过
  - [x] 整理规范的 PR 描述文档与测试报告
