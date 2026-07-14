import { parseFile } from '../src/parser';
import fs from 'fs';
import path from 'path';
import { expect, test } from 'vitest';

test('parseFile from buffer returns text', async () => {
  const res = await parseFile({ buffer: Buffer.from('hello world') as any });
  expect(res).toContain('hello world');
});

test('parseFile from path reads file content', async () => {
  const tmp = path.join(process.cwd(), 'packages', 'plugin-ai-summary', 'test-temp.txt');
  fs.writeFileSync(tmp, 'file content', 'utf8');
  const res = await parseFile({ path: tmp } as any);
  expect(res).toContain('file content');
  fs.unlinkSync(tmp);
});
