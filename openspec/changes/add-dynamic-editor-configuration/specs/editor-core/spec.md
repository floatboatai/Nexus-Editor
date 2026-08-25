# Editor Core Spec

## ADDED Requirements

### Requirement: provide reconfigure on EditorAPI

`EditorAPI` 必须提供 `reconfigure(config: DynamicEditorConfig): void` 方法，通过 CodeMirror 6 的 `Compartment` 机制原子化地更新编辑器的各项运行时配置（包括 `readOnly`、`tabSize`、`direction`、`indentGuides`、`theme`、`locale`），且在重配过程中不得销毁 DOM、不得重置文档内容、不得清空历史撤销栈或丢失当前选区。

#### Scenario: 动态切换只读模式 (readOnly)

- **GIVEN** 一个初始配置为 `readOnly: false` 的编辑器实例
- **WHEN** 调用 `editor.reconfigure({ readOnly: true })`
- **THEN** 编辑器应进入只读模式，禁止用户键盘输入与内容修改，且现有文档内容与光标位置保持不变

#### Scenario: 动态修改制表符缩进大小 (tabSize)

- **GIVEN** 一个初始配置为 `tabSize: 4` 的编辑器实例
- **WHEN** 调用 `editor.reconfigure({ tabSize: 2 })`
- **THEN** CodeMirror 内部的 `EditorState.tabSize` facet 应成功更新为 2

#### Scenario: 动态切换文本书写方向 (direction)

- **GIVEN** 一个默认 `direction: "ltr"` 的编辑器实例
- **WHEN** 调用 `editor.reconfigure({ direction: "rtl" })`
- **THEN** 编辑器内部 content DOM 属性应带有 `dir="rtl"`

#### Scenario: 动态批量合并重配 (Batch Reconfiguration)

- **WHEN** 在单次调用中传入 `editor.reconfigure({ readOnly: true, tabSize: 2, direction: "rtl" })`
- **THEN** 所有属性变更应在单个 CM6 事务 (Transaction) 中原子生效，不触发多次重复重绘

### Requirement: provide convenience setters on EditorAPI

`EditorAPI` 必须提供便捷的单属性 Setter 方法：`setReadOnly(readOnly: boolean)`、`setTabSize(tabSize: number)`、`setDirection(direction: 'ltr' | 'rtl')`、`setIndentGuides(enabled: boolean)`、`setLocale(locale: Partial<NexusLocale>)`。

#### Scenario: setReadOnly 切换可编辑状态

- **WHEN** 调用 `editor.setReadOnly(true)`
- **THEN** 编辑器变为不可编辑
- **WHEN** 随后调用 `editor.setReadOnly(false)`
- **THEN** 编辑器恢复正常编辑状态
