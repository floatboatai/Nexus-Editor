import { createNote } from '../src/createNote';
import fs from 'fs';
import { expect, test } from 'vitest';

test('createNote writes a file and returns path', async () => {
  const title = 'test-note';
  const content = 'hello note';
  const p = await createNote(title, content);
  expect(p).toBeTruthy();
  if (p) {
    const exists = fs.existsSync(p);
    expect(exists).toBe(true);
    const txt = fs.readFileSync(p, 'utf8');
    expect(txt).toContain(content);
    // cleanup
    fs.unlinkSync(p);
  }
});
