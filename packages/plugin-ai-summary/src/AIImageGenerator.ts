export async function generateImageFromText(text: string): Promise<string> {
  // 生成一个简单的 SVG 并返回 data URL（stub）。真实项目可替换为调用 AI 服务。
  const max = 300;
  const safe = text.slice(0, max).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400'>\n  <rect width='100%' height='100%' fill='#0f172a'/>\n  <text x='24' y='40' font-family='sans-serif' font-size='20' fill='#fff'>AI 摘要预览:</text>\n  <foreignObject x='24' y='60' width='752' height='320'>\n    <div xmlns='http://www.w3.org/1999/xhtml' style='color:white;font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif;font-size:16px;line-height:1.3;white-space:pre-wrap;'>${safe}</div>\n  </foreignObject>\n</svg>`;
  const b64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}
