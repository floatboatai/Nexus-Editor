# Mermaid Diagram Demo

这个文档用来验证 `@floatboat/nexus-core` 的 mermaid 渲染能力。光标离开代码块就会看到渲染好的图；
图右上角有常显的「✎ Edit」，点它或直接点图表都会进入编辑；光标再离开就会自动回到渲染态。

## 1. Flowchart — 简单流程图

```mermaid
flowchart TD
    A[用户输入 Markdown] --> B{是 mermaid 块?}
    B -->|是| C[MermaidWidget.toDOM]
    B -->|否| D[普通 code block 渲染]
    C --> E[lazy import mermaid]
    E --> F[mermaid.render -> SVG]
    F --> G[写入 MERMAID_CACHE]
    G --> H[view.requestMeasure]
```

## 2. Sequence Diagram — 时序图

```mermaid
sequenceDiagram
    participant User
    participant CM6 as CodeMirror
    participant W as MermaidWidget
    participant M as mermaid

    User->>CM6: 光标离开代码块
    CM6->>W: 构建 block widget
    W->>W: 检查 MERMAID_CACHE
    alt 缓存命中
        W-->>CM6: 同步返回 SVG
    else 缓存未命中
        W->>M: import("mermaid")
        M-->>W: mermaid API
        W->>M: render(id, source)
        M-->>W: { svg }
        W->>W: 缓存 svg + height
        W->>CM6: requestMeasure()
    end
```

## 3. Class Diagram — 类图

```mermaid
classDiagram
    class WidgetType {
        +toDOM() HTMLElement
        +eq(other) boolean
        +ignoreEvent() boolean
        +estimatedHeight number
    }
    class MermaidWidget {
        -source: string
        -viewRef: ViewRef
        -blockFrom: number
        +toDOM() HTMLElement
        +eq(other) boolean
    }
    class CodeCopyWidget {
        -code: string
        -lang: string
        +toDOM() HTMLElement
    }
    WidgetType <|-- MermaidWidget
    WidgetType <|-- CodeCopyWidget
```

## 4. State Diagram — 状态机

```mermaid
stateDiagram-v2
    [*] --> Rendered: 初始光标在块外
    Rendered --> Editing: 点击 ✎ 图标
    Rendered --> Editing: 光标进入块
    Editing --> Rendered: 光标离开块
    Editing --> Editing: 修改源码
    Rendered --> Rendered: 修改其它位置的文本
    Editing --> [*]: 删除整个块
    Rendered --> [*]: 删除整个块
```

## 5. Gantt — 项目排期

```mermaid
gantt
    title Nexus-Editor Roadmap
    dateFormat YYYY-MM-DD
    section Editor Core
    Live preview            :done, 2026-03-01, 30d
    Click-drift fix         :done, 2026-04-10, 10d
    Mermaid preview         :active, 2026-04-20, 2d
    section Vault
    Wiki links              :done, 2026-04-18, 3d
    Backlinks panel         :done, 2026-04-19, 2d
```

## 6. Pie — 饼图

```mermaid
pie title Bundle Composition (approx)
    "CM6 core" : 180
    "highlight.js" : 90
    "mdast/remark" : 60
    "Nexus code" : 106
    "other" : 40
```

## 7. Git Graph — 分支图

```mermaid
gitGraph
    commit id: "init"
    commit id: "live-preview"
    branch feat/mermaid
    commit id: "widget"
    commit id: "lazy-import"
    commit id: "tests"
    checkout main
    merge feat/mermaid tag: "v0.3"
    commit id: "docs"
```

## 语法错误兜底

故意写错一个，应该看到红色错误条而不是白屏：

```mermaid
graph TD
    this is intentionally broken >>>
```

---

回 [[index]] ｜ 相关代码：`packages/core/src/live-preview.ts` 的 `MermaidWidget`
