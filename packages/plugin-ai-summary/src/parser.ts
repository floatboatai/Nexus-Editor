export async function parseFile(file: File | { path?: string; buffer?: Buffer }): Promise<string> {
  // 简单实现：若为浏览器 File，且为文本类型，则读取文本；其它类型返回占位文本（stub）
  if (typeof File !== 'undefined' && file instanceof File) {
    const name = (file as File).name || 'file';
    const text = await (file as File).text();
    if (text && text.length > 0) return text;
    return `Parsed text from ${name} (stub)`;
  }

  // Node 环境下的 buffer/path 支持（简单 stub）
  // @ts-ignore
  if (file && file.buffer) {
    // @ts-ignore
    return file.buffer.toString('utf8');
  }

  if (file && file.path) {
    try {
      // 使用 require 动态加载 fs
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      const content = fs.readFileSync(file.path, 'utf8');
      return content;
    } catch (e) {
      return `Parsed text from ${file.path} (stub)`;
    }
  }

  return 'Parsed text (stub)';
}
