# 教训 - 模块化UI委托

## 关联用例

### FP-06-01 core 只计算坐标+选区状态（11条）
- FP-06-01-N01 [P1] [正常] [Vitest] 输入斜杠触发坐标+选区状态计算并 emit，core 不创建任何菜单 DOM
- FP-06-01-N02 [P1] [正常] [Vitest] 状态载荷携带 coords 字段（BoundingClientRect 契约），jsdom 无布局时 null 降级合法
- FP-06-01-N03 [P1] [正常] [Vitest] core 零 UI 渲染：slash 状态变化不改变编辑器容器与 body 的 DOM
- FP-06-01-N04 [P2] [正常] [Vitest] 选区状态与 slash 状态一致：selectionChange 与 slashMenuChange 位置信息互相对应
- FP-06-01-F01 [P2] [流程] [Vitest] 输入→光标移出→移回：菜单状态随光标生命周期开/关
- FP-06-01-E01 [P3] [异常] [Vitest] 未注册任何 slashCommands 时不 emit（无命令源不打扰宿主）
- FP-06-01-E02 [P3] [异常] [Vitest] 行内 URL/路径中的斜杠（前导非空白字符）不触发 slash 匹配
- FP-06-01-E03 [P3] [异常] [Vitest] query 含空白字符时菜单关闭（isOpen=false）
- FP-06-01-B01 [P4] [边界] [Vitest] 光标位于文档首字符（doc="/"）时 from=0/to=1
- FP-06-01-B02 [P4] [边界] [Vitest] 多行文档仅当前行行首斜杠触发，跨行 from 偏移正确
- FP-06-01-D01 [P5] [数据] [Vitest] coords 数据契约：字段存在且为 null 或 {left, top, bottom} 三数值

### FP-06-02 editor.on('slashMenuChange') 状态订阅（11条）
- FP-06-02-N01 [P1] [正常] [Vitest] on 订阅后输入触发回调，载荷为完整 SlashMenuState（六字段齐备）
- FP-06-02-N02 [P1] [正常] [Vitest] off 取消订阅后不再回调
- FP-06-02-N03 [P2] [正常] [Vitest] 多订阅者广播：两个 handler 均收到同一 state
- FP-06-02-N04 [P2] [正常] [Vitest] 关闭状态推送：光标移出 slash 后回调收到 isOpen=false 且 commands 为空
- FP-06-02-F01 [P2] [流程] [Vitest] 连续键入 "/h"→"/he"→"/hea" 回调序列与末次载荷 query="hea"
- FP-06-02-E01 [P3] [异常] [Vitest] off 从未注册的 handler 幂等安全（不抛错）
- FP-06-02-E02 [P3] [异常] [Vitest] 同一 handler 重复 on 两次仅回调一次（EventEmitter Set 去重）
- FP-06-02-E03 [P3] [异常] [Vitest] slashMenuLimit=0 时 isOpen=true 且 commands=[]（无结果占位契约）
- FP-06-02-B01 [P4] [边界] [Vitest] slashMenuLimit=3 时命令排名后截断为 3 条
- FP-06-02-B02 [P4] [边界] [Vitest] destroy() 后残留订阅不再触发回调
- FP-06-02-D01 [P5] [数据] [Vitest] commands 载荷与 getSlashCommands() 同源（id/title 字段与排名顺序契约）

### FP-06-03 宿主渲染绝对定位组件（6条）
- FP-06-03-N01 [P1] [正常] [Vitest] 宿主渲染：createSlashMenuUI 挂载菜单到 body（position: fixed）
- FP-06-03-N02 [P2] [正常] [Vitest] 宿主渲染：reposition 使用 coords（left / bottom+offset 定位）
- FP-06-03-E01 [P3] [异常] [Vitest] jsdom 无布局 coords=null：菜单仍可见但位置保持默认
- FP-06-03-E02 [P3] [异常] [Vitest] 菜单节点随 destroy 清理：解除订阅 + 移除 DOM
- FP-06-03-B01 [P4] [边界] [Vitest] 自定义容器：菜单挂载到 ShadowRoot（隔离样式，完全脱离 overflow 上下文）
- FP-06-03-F01 [P2] [流程] [Vitest] 打开→选择→关闭 完整生命周期（宿主渲染驱动）

## 重要发现

1. **用例文档笔误（非产品 BUG）**：
   - FP-06-01-N02 断言 `from===1` 有误：`/hea` 斜杠在位置 0，`getSlashMatch` 返回 `lineStart+slashIndex=0`，实际 from=0。
   - FP-06-01-E02 断言 `setSelection(19)` 越界：`"http://example.com"` 实为 18 字符。
   - FP-06-01-F01 / D01 断言 `setSelection(11)` 越界：`"plain text"` 实为 10 字符。
2. **零 UI 渲染断言不能比对 container.innerHTML/节点数**：CM6 在 setDocument 内容变化时行 DOM 必然变化，与 slash 无关。正确做法：断言 `.nexus-slash-menu` 恒为 null + body 子节点数稳定。
3. **回调时序**：`setDocument` 与 `setSelection` 各触发一次 slashMenuChange（docChanged + selectionSet 两个 update），故连续键入时 query 序列含重复值；断言应取每步"末次载荷"。
4. **EventEmitter 去重**：同一 handler 重复 `on` 只投递 1 份（Set 存储）。
5. **slashMenuLimit**：0 → commands=[]（无结果占位契约）；N → 截断前 N 条（保持注册序）。
6. **createSlashMenuUI**：`reposition` 在 coords=null 时 display=block 但 left/top 保持默认（JSDOM 无布局合法降级）；菜单固定 `position:fixed`；支持 ShadowRoot 容器；destroy 幂等清理 DOM+订阅。
7. **confirm 生命周期**：选择 item 先删 `/query`（setSelection+replaceSelection）再回调 onCommand/run，context.trigger 携带原始 from/to/query。

## 额外教训

- Vitest 通道 28 条用例一次执行全部通过，无 BUG、无与预期不符；3 处用例文档笔误按实际正确行为断言并注明。
