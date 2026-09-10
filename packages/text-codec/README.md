# 文档文本编解码

`@floatboat/nexus-text-codec` 提供显式、有限额的字节与 Unicode 文本转换，不读取文件、不写入磁盘，不改变编辑器默认行为。

## Unicode 主入口

```ts
import { decodeDocumentBytes, encodeDocumentText } from "@floatboat/nexus-text-codec";

const decoded = decodeDocumentBytes(bytes);
if (decoded.status === "decoded") {
  // text 使用 LF；原编码、BOM、换行种类保存在 format 中。
  const nextBytes = encodeDocumentText(decoded.text, { format: decoded.format });
  // 由宿主决定是否保存，并校验原始磁盘字节的版本。
}
```

主入口支持 UTF-8、UTF-16LE/BE，不加载传统编码表，也不依赖 Node 或 DOM。自动识别仅采用 Unicode BOM 和严格 UTF-8；BOM 缺失且包含空字节、或 UTF-8 不合法时返回 `needs-encoding`。`candidates` 只是待确认选项，不是已识别结果或置信度排名。明确指定的编码与 BOM 冲突时拒绝；UTF-32 不在支持范围。

`FF FE 00 00` 既可能是 UTF-32LE 标记，也可能是 UTF-16LE 标记后紧跟正文 U+0000。自动模式保守拒绝该歧义；宿主明确传入 `encoding: "utf-16le"` 时按 UTF-16LE 解码并保留正文空字符，不因此增加 UTF-32 支持。

## 显式启用传统编码

```ts
import { decodeDocumentBytes, encodeDocumentText } from "@floatboat/nexus-text-codec";
import { legacyTextCodec } from "@floatboat/nexus-text-codec/legacy";

// 宿主先让用户确认编码，不能自动用 candidates[0] 写回。
const decoded = decodeDocumentBytes(bytes, { encoding: "gbk", legacyCodec: legacyTextCodec });
if (decoded.status === "decoded") {
  const nextBytes = encodeDocumentText(decoded.text, {
    format: decoded.format,
    legacyCodec: legacyTextCodec,
  });
}
```

支持 GBK、GB18030、Big5、Shift_JIS。`legacy` 单独打包编码表和模块内部的 Buffer 实现，浏览器与 Node 均可导入，不设置 `globalThis.Buffer`，不需要全局 polyfill。也可通过 `LegacyTextCodec` 注入宿主自己的实现。

## 安全语义

- 新文档默认 UTF-8、无 BOM、LF；不添加末尾换行，不进行 NFC/NFKC 归一化。
- 解码去掉文件 BOM，第二个属于正文的 U+FEFF 保留；正文以 U+FEFF 开头时，编码必须明确启用 BOM，避免下次读取把正文当成文件标记而丢失。UTF-16 的奇数字节和非法 surrogate 拒绝。
- 传统编码执行保守往返检查；非法、替代或不能原样往返的输入拒绝。这可能拒绝合法但非规范的别名字节，不能把这种错误误称为已可靠识别编码。
- 编码拒绝孤立 surrogate 和不可表示字符；例如 GBK 不能保存 emoji 时抛出 `unrepresentable-text`，不会静默变成 `?`。宿主可以提供明确的“另存 UTF-8”。
- `format.eol === "mixed"` 时必须明确传入 `eol: "lf" | "crlf" | "cr"` 才能重新编码。不承诺编辑后逐行保持混合换行；没有修改的文件应由宿主跳过重写以保留原字节。
- 输入及编码输出默认最多 16 MiB，可通过 `maxBytes` 显式调整；编码限额包括 BOM。操作同步执行，长任务的硬取消由宿主 Worker 负责。
- 所有格式失败使用 `TextCodecError.code`；配置限额或换行值不合法时使用 `RangeError`。

编码器只返回新字节。文件 CAS 必须使用原始字节版本，不能用 LF 正文的 hash 替代；改编码、BOM 或 EOL 都可能改变磁盘版本。授权、覆盖确认和原子写入属于宿主。

## 验证

`pnpm test` 运行 Unicode、常用传统编码、候选确认、BOM/EOL、限额与有损拒绝回归。`pnpm check:api` 构建公开声明，并在无 Node 全局变量的隔离环境执行实际浏览器 bundle；该检查不是完整浏览器 UI 测试。
