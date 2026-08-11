# 03 — OpenSpec 规范汇总

> 对应源码：`openspec/changes/` | 9 个变更提案，覆盖所有已实现功能

---

## OpenSpec 流程

```
① 提案（proposal.md）→ ② 实现（按 tasks.md）→ ③ 归档
```

每个提案的 spec 文件用 `ADDED` / `MODIFIED` / `REMOVED` + `Scenario` 格式定义验收标准。

---

## 1. add-missing-features — 核心功能补全

### editor-core/spec.md

| Requirement | 场景 | 对应 API |
|---|---|---|
| 国际化框架 | 默认英文 / 中文 / 部分覆盖 | `locale` 配置 |
| 目录提取 | 从文档提取标题层级 | `editor.getTableOfContents()` |
| HTML 导出 | 转换为语义 HTML | `editor.exportHTML()` |
| 运行时主题切换 | 切换主题且保留状态 | `editor.setTheme(theme)` |

### live-preview/spec.md

| Requirement | 场景 |
|---|---|
| 嵌套行内格式 | `***bold italic***` 渲染组合样式 |
| 脚注引用和定义 | `[^1]` 渲染为上标，定义渲染在底部 |
| GFM 自动链接 | 裸 URL 渲染为可点击链接 |
| Ctrl+Click 打开链接 | mark 装饰的链接支持新标签页打开 |
| 缩进代码块 | 4 空格缩进获得代码块样式 |
| 代码块和标题折叠 | 点击折叠指示器收起/展开 |
| Enter 自动续行 | 列表/引用/有序列表自动添加前缀 |
| 链接和图片悬停预览 | 悬停显示 URL tooltip / 图片缩略图 |

### plugins/spec.md

| Requirement | 场景 |
|---|---|
| 搜索插件 | Mod+F 打开面板、可折叠替换行、Enter 导航匹配 |
| Mermaid 图表 | 光标在外渲染 SVG，光标在内显示源码 |
| 列表拖拽排序 | 拖拽列表项手柄重新排序 |

### theming/spec.md

| Requirement | 场景 |
|---|---|
| 主题配置 API | `NexusTheme` 接口定义所有视觉属性 |
| 内置亮色/暗色 | `lightTheme` / `darkTheme` 预设 |
| CSS 自定义属性 | 所有值通过 `--nexus-*` 变量设置 |
| 运行时切换 | `setTheme()` 不重建编辑器 |

---

## 2. add-core-multi-cursor — 多光标编辑

### editor-core/spec.md

| Requirement | 场景 |
|---|---|
| 多光标配置开关 | `multiCursor: true` 启用；默认保持单选区行为 |
| 选区 API | `getSelections()` 返回所有范围 + `setSelections()` 设置多范围 |
| 选区变更事件 | `selectionChange` 载荷扩展为 `{ anchor, head, ranges, mainIndex }` |

### multi-cursor/spec.md

| Requirement | 场景 |
|---|---|
| 选择下一个匹配 | `Mod-D`：空光标先扩词，再次调用添加下一个匹配（环绕） |
| 上/下添加光标 | `Mod-Alt-↑/↓`：列保持，短行夹紧到行尾 |
| 折叠到主选区 | `Escape`：减少到主范围；单选区时返回 false 放行 |
| Enter 处理每个范围 | 多光标列表续行在单次 dispatch 中完成（一次撤销） |
| 自动配对处理每个范围 | `` ` `` / `**` / `~~` 包裹所有选中的词 |
| Live Preview 在每个光标揭示 | 所有光标位置同时显示原始语法 |
| 表格范围检查考虑所有范围 | 任一范围覆盖表格则显示全选叠加层 |

---

## 3. add-selection-api — 选区 API

### editor-core/spec.md

| Requirement | 场景 |
|---|---|
| `getSelectedText()` | 折叠返回空串；反向选区归一化；多行保留换行 |
| `replaceRange()` | 单事务替换+可选选区重定位；`silent` 抑制 onChange；一次撤销 |

### plugin-toolbar/spec.md

| Requirement | 场景 |
|---|---|
| 列表切换作用于选区所有行 | 混合状态→全加；交叉标记替换；列 0 边界排除尾行；原子撤销 |

---

## 4. add-slash-menu-ui — 斜杠菜单 UI

### editor-core/spec.md

| Requirement | 场景 |
|---|---|
| 命令 `run` 回调 | 有 run 则可执行；无 run 仍作为元数据条目 |
| 排序算法 | 6 级优先级 + 字母序兜底 + 空查询保持注册顺序 |
| 结果限制 | `limit` 默认 8，0 返回空列表但 `isOpen` 仍为 true |

### slash-menu/spec.md

| Requirement | 场景 |
|---|---|
| 挂载和生命周期 | 初始隐藏；destroy 清理所有监听和引用 |
| 菜单打开和渲染 | 每个命令一个元素 + `data-slash-command-id`；空结果显示提示 |
| 键盘导航 | ↑↓ 移动高亮（环绕）；Home/End 跳首尾；Enter/Tab 确认；Escape 关闭 |
| 鼠标交互 | hover 同步高亮；click 确认；外部 pointerdown 关闭 |
| 坐标定位+视口翻转 | 默认在光标下方；超出底部翻到上方；右溢出夹紧 |
| IME 感知 | 合成期间抑制所有键盘处理 |
| 无障碍 | `role="listbox"` + `role="option"` + `aria-activedescendant` |
| 命令执行策略 | 先删除 `/query` 范围 → onCommand 覆盖 > cmd.run > 静默 |

---

## 5. add-note-vault — 笔记库系统

| Requirement | 场景 |
|---|---|
| Vault 选择 | 用户选择目录作为 vault，持久化路径 |
| 文件列表 | 仅 .md/.markdown/.txt；排除 .git/node_modules；空目录剪枝 |
| 文件切换+脏数据保护 | clean/dirty confirmed/dirty cancelled 三种场景 |
| 新建文件和文件夹 | 自动补 .md；重名加 -1/-2 后缀 |
| 重命名 | 磁盘重命名 + 更新活动文件路径；冲突拒绝 |
| 删除到回收站 | `shell.trashItem`；失败不硬删 |
| 外部变更监听 | 新文件 300ms 内出现；活动文件被删保留内容可另存 |
| 路径安全 | `../../` 穿越攻击被拒绝 |
| 持久化和自动恢复 | 启动时恢复上次 vault；路径不存在则清除 |
| 向后兼容 | 无 vault 时单文件 Open/Save 仍工作 |

---

## 6. add-wikilinks — 双链支持

### live-preview/spec.md

| Requirement | 场景 |
|---|---|
| 行内渲染 | `[[target]]` / `[[target|alias]]` → 光标感知 mark 装饰 |
| 已解决/未解决样式 | resolve 返回路径→accent 色 pointer；返回 null→muted 色 dashed |
| 点击导航 | `onNavigate(target, { unresolved })` |
| 自动补全 | `[[` 后触发 `suggest(query)` |

### note-vault/spec.md

| Requirement | 场景 |
|---|---|
| 批量读取 | `vault:read-all` 返回所有 md 文件 `{ path, content }` |
| 双链索引 | `resolve(name, fromPath)` / `getBacklinks(target)` / `updateFile` / `removeFile` |
| 反向链接面板 | 列出所有引用当前文件的条目 + 上下文片段；点击跳转 |
| 双链导航 | 点击已解决链接打开目标；未解决则创建文件后打开 |

---

## 7. add-plugin-wordcount — 字数统计

| Requirement | 场景 |
|---|---|
| Markdown 感知计数 | 排除 code/math/html/yaml/frontmatter；不抛异常 |
| CJK 计数 | 默认逐字符；`cjkUnit: "word"` 合并连续同脚本运行 |
| 阅读时间 | `ceil(latinWords/wpm*60 + cjkChars/cpm*60)` |
| 插件工厂和生命周期 | NexusPlugin + WordCountAPI 合体；debounce 150ms |
| 状态栏 Widget | `role="status"` + `aria-live="polite"`；选区摘要 |
| 国际化标签 | 所有可见字符串可覆盖 |
| 不重复解析 | 编辑器内复用 `editor.getAst()` |

---

## 8. add-search-query-history — 搜索历史

| Requirement | 场景 |
|---|---|
| 仅搜索第一阶段 | 只管搜索查询历史，斜杠命令历史是后续工作 |
| 可选向后兼容 | 默认禁用；禁用时不读写存储 |
| 宿主注入存储 | 不隐式写 global localStorage |
| 查询保留规则 | trim 后记录；去重移前；maxEntries 截断 |
| 存储故障韧性 | JSON 无效/getItem throw/setItem throw 均不崩溃 |
| 键盘历史回溯 | ↑↓ 回溯历史条目；空历史/禁用时不消耗按键 |

---

## 9. add-slash-recent-command-history — 斜杠命令历史

| Requirement | 场景 |
|---|---|
| 可选默认禁用 | 不启用时保持注册顺序 |
| 记录命令不记录查询 | 只存 confirmed command id，不存 `/query` 文本 |
| 禁用时保持现有语义 | 键盘和点击行为不变 |
| recency 排序应用于空查询菜单 | 最近使用的命令排前面 |
| 重排菜单确认渲染的活动命令 | 确认的是高亮/点击的渲染项，非原始索引 |
| 仅宿主注入存储 | 不隐式写 global localStorage |
| 存储故障非致命 | JSON 无效/getItem throw/setItem throw 均不崩溃 |
| 未知命令 id 被忽略 | 已删除的命令不渲染幽灵项 |
| 去重移前+maxEntries | 重复命令移到前面只出现一次；超出截断 |

---

## 规范与代码的追溯矩阵

| 功能 | Spec 文件 | 代码实现 | 测试 |
|---|---|---|---|
| 国际化 | add-missing-features/editor-core | `locale.ts` | `locale.test.ts` |
| 目录提取 | add-missing-features/editor-core | `editor.ts` getTableOfContents | `editor.test.ts` |
| HTML 导出 | add-missing-features/editor-core | `editor.ts` exportHTML | `editor.test.ts` |
| 主题 | add-missing-features/theming | `theme.ts` | `theme.test.ts` |
| Live Preview | add-missing-features/live-preview | `live-preview.ts` | `live-preview.test.ts` |
| 搜索 | add-missing-features/plugins | `plugin-search/index.ts` | `plugin-search.test.ts` |
| 多光标 | add-core-multi-cursor/multi-cursor | `multi-cursor.ts` | `multi-cursor.test.ts` |
| 斜杠菜单 | add-slash-menu-ui/slash-menu | `plugin-slash/menu-ui.ts` | `menu-ui.test.ts` |
| Vault | add-note-vault/note-vault | `electron-demo/electron/main.ts` | `app-handlers.test.ts` |
| 双链 | add-wikilinks/live-preview + note-vault | `wikilinks.ts` + `link-index.ts` | `wikilinks.test.ts` + `link-index.test.ts` |
| 字数统计 | add-plugin-wordcount/wordcount | `plugin-wordcount/plugin.ts` | `plugin.test.ts` + `count.test.ts` |
| 搜索历史 | add-search-query-history/plugins | `plugin-search/index.ts` | `plugin-search.test.ts` |
| 斜杠命令历史 | add-slash-recent-command-history/plugins | `plugin-slash/command-history.ts` | `plugin-slash.test.ts` |
| 选区 API | add-selection-api/editor-core | `editor.ts` | `editor.test.ts` |
