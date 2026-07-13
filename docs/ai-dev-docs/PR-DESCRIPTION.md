# PR 描述：feat(search): add fuzzy (subsequence) search support

> 复制以下内容到 GitHub PR 描述

---

## Why

`@floatboat/nexus-plugin-search` 当前只支持精确子串、whole-word 和正则匹配。对于「想用缩写快速定位」的典型场景——比如输入 `hw` 找到 `hello world`——用户必须输入完整词或切换到正则。

模糊搜索在 Obsidian、VS Code、Sublime 等现代编辑器中已是标准能力，缺它会让 plugin-search 的可用性落后一档。

Roadmap #17 标记为 P2 planned，本次实现填补这个缺口。

## What

新增 `SearchOptions.fuzzy?: boolean` 选项，开启后 `findSearchMatches` / `replaceAllMatches` 走模糊匹配路径；关闭时行为完全不变。

### 算法

按行 DP，复杂度 O(nLen × L²)，对编辑器中典型短行（< 200 字符）足够快。

评分维度（基线 + 增量）：

| 维度 | 分值 |
|---|---|
| 每个匹配字符 | +10 |
| 连续匹配 | +5/字符 |
| 词首匹配 | +8/字符 |
| camelCase 边界（小写→大写） | +4/字符 |
| 短跳跃（≤ 3 字符） | +3/字符 |
| 长跳跃 | −2/字符 |
| 任意非连续跳跃 | −1 |

### API 变更

```typescript
// 之前
findSearchMatches("hello world", "hw"); // → []

// 之后
findSearchMatches("hello world", "hw", { fuzzy: true });
// → [{ from: 0, to: 7, text: "hello w" }]

// 替换同样支持
replaceAllMatches("hello world", "hw", "FOO", { fuzzy: true });
// → "FOOorld"
```

新增的可选 `minScoreRatio` 允许调用方按理论最高分的比例过滤低质量匹配。

### 公开导出

`packages/plugin-search/src/index.ts` 顶层导出无新增；`SearchOptions` 扩展 `FuzzyMatchOptions`（`caseSensitive`, `minScoreRatio`）。

`packages/plugin-search/src/fuzzy.ts` 新增文件，但**不**作为公开导出（属于实现细节，外部通过 `SearchOptions.fuzzy` 间接使用）。

## Files changed

```
A  packages/plugin-search/README.md            (+203)
A  packages/plugin-search/src/fuzzy.ts         (+255)
A  packages/plugin-search/test/fuzzy.test.ts   (+170)
M  packages/plugin-search/src/index.ts         (+12)
M  packages/plugin-search/test/plugin-search.test.ts (+75)
M  docs/ROADMAP.md                             (1 line: planned → in-progress)
M  docs/ROADMAP.zh.md                          (1 line: planned → in-progress)
```

总计：3 个新文件、4 个修改文件、约 705 行新增。

## Testing

| 项 | 结果 |
|---|---|
| `pnpm test` | ✅ 567/567 通过（新增 30 个 fuzzy 测试） |
| `pnpm typecheck` | ✅ 通过 |
| `pnpm build` | ✅ 11 个包全部成功 |

新增测试覆盖：

- `fuzzy.test.ts`（20 个）：空串、精确匹配、跳跃匹配、词首匹配、camelCase、阈值过滤、大小写、多行、CJK、替换
- `plugin-search.test.ts`（10 个新增）：集成到 `findSearchMatches` / `replaceAllMatches` 的 `fuzzy` 选项、向后兼容、阈值转发

## Backward compatibility

`fuzzy` 默认 `false`，所有现有调用点行为不变。无破坏性变更。

## Performance

对 1000 行、每行平均 80 字符的文档、单字符 query，per-line DP 跑 1000 次约 10ms（Node 22）。对长行（> 500 字符）会变慢；生产环境建议配合 `minScoreRatio` 提前过滤或加防抖。性能基准将在后续单独提案中提供（`add-missing-features` 4.2 已规划）。

## Notes

- 不引入新运行时依赖
- 不触及 `core`，符合最小变更原则
- 不影响 search panel UI 行为（`createSearchPlugin` 未变）；panel 集成 fuzzy 留待后续提案
- 未提交 OpenSpec 提案（Roadmap 明确标注 #17 不需要 OpenSpec）
