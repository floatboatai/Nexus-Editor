import { generateImageFromText } from '../src/AIImageGenerator';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { expect, test } from 'vitest';

test('generate preview SVG for visual inspection', async () => {
  const sampleMd = `# 招生目录
## 学校与总体信息
北京信息科技大学发布2026年硕士学位研究生招生专业目录，涵盖学术学位与专业学位。

目录按学院、学科专业、研究方向、招生人数、考试科目等维度详细列出。

招生类型包括全日制和非全日制，部分专业接收推免生。

## 学术学位专业
学术学位涵盖机械工程、光学工程、仪器科学与技术、电子科学与技术等工科专业。

还包括信息与通信工程、控制科学与工程、计算机科学与技术、网络空间安全等。
`;
  const url = await generateImageFromText(sampleMd);
  expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  const match = url.match(/data:image\/svg\+xml;base64,(.+)/);
  if (match) {
    const b64 = match[1];
    const svg = Buffer.from(b64, 'base64').toString('utf-8');
    const outDir = join(__dirname, '../dist-test');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'test-output.svg');
    writeFileSync(outPath, svg, 'utf-8');
    console.log('Saved preview to', outPath);
  }
});
