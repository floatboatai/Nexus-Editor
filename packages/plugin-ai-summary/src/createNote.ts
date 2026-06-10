export async function createNote(title: string, content: string): Promise<string | null> {
  // 尝试在 Node 环境中写入示例 vault 路径（apps/electron-demo/sample-vault/personal）
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const folder = path.resolve(process.cwd(), 'apps', 'electron-demo', 'sample-vault', 'personal');
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    const timestamp = Date.now();
    const filename = `${title.replace(/[^a-z0-9_-]/gi, '_') || 'ai-summary'}-${timestamp}.md`;
    const filepath = path.join(folder, filename);
    const md = `# ${title}\n\n${content}\n`;
    fs.writeFileSync(filepath, md, 'utf8');
    return filepath;
  } catch (e) {
    // 无写权限或在浏览器环境中，返回 null
    return null;
  }
}
