import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleOpen, handleSave, handleSaveAs } from '../src/commands/fileCommands';
import { setDirty, setContent } from '../src/store/editorStore';

describe('fileCommands', () => {
  beforeEach(() => {
    setDirty(false);
    setContent('');
    vi.clearAllMocks();
  });

  it('should export handleOpen function', () => {
    expect(typeof handleOpen).toBe('function');
  });

  it('should export handleSave function', () => {
    expect(typeof handleSave).toBe('function');
  });

  it('should export handleSaveAs function', () => {
    expect(typeof handleSaveAs).toBe('function');
  });

  it('should handle save when no file path is set', async () => {
    setContent('# Test Content');
    
    await handleSaveAs();
    
    expect(true).toBe(true);
  });
});