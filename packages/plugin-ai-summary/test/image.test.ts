import { generateImageFromText } from '../src/AIImageGenerator';
import { expect, test } from 'vitest';

test('generateImageFromText returns a data URL', async () => {
  const url = await generateImageFromText('测试内容');
  expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
});
