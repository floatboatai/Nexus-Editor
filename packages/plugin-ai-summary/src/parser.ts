// Simple string hashing (djb2) used for cache keys
function _hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  // ensure unsigned
  return (h >>> 0).toString(16);
}

const _parseCache: Map<string, string> = new Map();
const _PARSE_CACHE_PREFIX = 'plugin-ai-summary.parse.';

export function clearParseCache() {
  _parseCache.clear();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i) || '';
        if (k.startsWith(_PARSE_CACHE_PREFIX)) keys.push(k);
      }
      for (const k of keys) window.localStorage.removeItem(k);
    }
  } catch (e) {
    // ignore
  }
}

export async function parseFile(file: File | { path?: string; buffer?: Buffer }): Promise<string> {
  // 目标：尽量从多种来源提取文本，并对常见格式进行预处理，
  // 1) 支持浏览器 File、Node Buffer、文件路径
  // 2) 对 HTML 做标签剥离
  // 3) 对 PDF 尝试使用 pdf-parse（若可用）提取文本
  // 4) 将嵌套列表转换为伪 Markdown 标题，方便 downstream 以标题/列表为基础构建树

  async function readFileContent(): Promise<string> {
    // 浏览器 File
    try {
      // @ts-ignore
      if (typeof File !== 'undefined' && file instanceof File) {
        const name = (file as File).name || 'file';
        const text = await (file as File).text();
        if (text && text.length > 0) return text;
        return `Parsed text from ${name} (stub)`;
      }
    } catch (e) {
      // ignore and continue to Node-style handling
    }

    // Node: buffer provided (e.g., uploaded binary)
    if (file && typeof (file as any).buffer !== 'undefined' && (file as any).buffer) {
      // try to detect PDF by header
      const buf: Buffer = (file as any).buffer;
      const header = buf.slice(0, 8).toString('utf8');
      if (header.startsWith('%PDF')) {
        // try to require pdf-parse if available
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const pdfParse = require('pdf-parse');
          // pdfParse may be sync or return promise
          // @ts-ignore
          const data = await pdfParse(buf);
          if (data && data.text) return data.text as string;
        } catch (e) {
          // fallback to raw buffer text
        }
      }
      return buf.toString('utf8');
    }

    // Node: path provided
    if (file && typeof (file as any).path === 'string') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        const path = (file as any).path as string;
        const ext = (path.match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase() || '';
        const raw = fs.readFileSync(path);
        // If HTML, strip tags
        if (ext === 'html' || ext === 'htm') {
          const s = raw.toString('utf8');
          return s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
        }
        // If markdown or txt, return utf8
        if (['md', 'markdown', 'txt', 'text'].includes(ext)) {
          return raw.toString('utf8');
        }
        // If pdf path, try pdf-parse
        if (ext === 'pdf') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const pdfParse = require('pdf-parse');
            // @ts-ignore
            const data = await pdfParse(raw);
            if (data && data.text) return data.text as string;
          } catch (e) {
            // fallthrough to raw
          }
        }
        return raw.toString('utf8');
      } catch (e) {
        return `Parsed text from ${(file as any).path} (stub)`;
      }
    }

    return 'Parsed text (stub)';
  }

  // Convert nested list items to pseudo-headings so downstream tree builder can pick up deep lists
  function transformNestedListsToHeadings(input: string): string {
    const lines = input.split(/\r?\n/);
    const out: string[] = [];
    for (const raw of lines) {
      // detect list items with leading spaces
      const m = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (m) {
        const spaces = m[1] || '';
        const text = m[3] || '';
        // treat every 2 spaces as one additional nesting level (heuristic)
        const indentLevel = Math.min(5, Math.floor(spaces.replace(/\t/g, '    ').length / 2));
        // map indentLevel 0 -> level 2 heading, indentLevel 1 -> level3, etc.
        const headingLevel = Math.min(6, 2 + indentLevel);
        const hashes = '#'.repeat(headingLevel);
        out.push(`${hashes} ${text}`);
      } else {
        out.push(raw);
      }
    }
    return out.join('\n');
  }

  // Simple inline formatting cleanup: remove backticks, bold/italic markers, keep link text
  function stripInlineMarkdown(input: string): string {
    return input
      // links: [text](url) -> text
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      // images: ![alt](url) -> alt
      .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1')
      // bold/italic markers
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      // inline code
      .replace(/`([^`]+)`/g, '$1');
  }

  const raw = await readFileContent();
  // Try cache first (cache key based on raw content)
  try {
    const key = _PARSE_CACHE_PREFIX + _hashString(raw || '');
    if (_parseCache.has(key)) return _parseCache.get(key)!;
    if (typeof window !== 'undefined' && window.localStorage) {
      const persisted = window.localStorage.getItem(key);
      if (persisted) {
        _parseCache.set(key, persisted);
        return persisted;
      }
    }
  } catch (e) {
    // ignore cache errors
  }
  // Normalize newlines and trim excessive blank lines
  let processed = raw.replace(/\r\n/g, '\n').replace(/\t/g, '    ');
  // If the content looks like HTML (starts with <), strip tags
  if (/^\s*</.test(processed) && /<\w+/.test(processed)) {
    processed = processed.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }

  // Transform nested lists into headings to preserve structure
  processed = transformNestedListsToHeadings(processed);

  // Strip inline formatting to keep node titles clean
  processed = stripInlineMarkdown(processed);

  // Collapse multiple blank lines
  processed = processed.replace(/\n{3,}/g, '\n\n');

  // store in cache (memory + localStorage if available)
  try {
    const key = _PARSE_CACHE_PREFIX + _hashString(raw || '');
    _parseCache.set(key, processed);
    if (typeof window !== 'undefined' && window.localStorage) {
      try { window.localStorage.setItem(key, processed); } catch (e) { /* ignore quota */ }
    }
  } catch (e) {
    // ignore
  }

  return processed;
}
