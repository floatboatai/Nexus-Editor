import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleUndo, handleRedo, handleSearch, handleSettings } from '../src/commands/editCommands';
import { setEditor } from '../src/store/editorStore';

describe('editCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setEditor(null as any);
  });

  it('should export handleUndo function', () => {
    expect(typeof handleUndo).toBe('function');
  });

  it('should export handleRedo function', () => {
    expect(typeof handleRedo).toBe('function');
  });

  it('should export handleSearch function', () => {
    expect(typeof handleSearch).toBe('function');
  });

  it('should export handleSettings function', () => {
    expect(typeof handleSettings).toBe('function');
  });

  it('should call undo on editor', () => {
    const mockEditor = { undo: vi.fn() } as any;
    setEditor(mockEditor);
    
    handleUndo();
    
    expect(mockEditor.undo).toHaveBeenCalled();
  });

  it('should call redo on editor', () => {
    const mockEditor = { redo: vi.fn() } as any;
    setEditor(mockEditor);
    
    handleRedo();
    
    expect(mockEditor.redo).toHaveBeenCalled();
  });

  it('should handle search command', () => {
    const mockEditorAPI = {} as any;
    const mockEditor = { getEditorAPI: vi.fn().mockReturnValue(mockEditorAPI) } as any;
    setEditor(mockEditor);
    
    document.body.innerHTML = '<div class="editor-column"></div>';
    
    handleSearch();
    
    expect(mockEditor.getEditorAPI).toHaveBeenCalled();
  });

  it('should handle settings command', () => {
    const mockEditor = { setAttribute: vi.fn() } as any;
    setEditor(mockEditor);
    
    handleSettings();
  });
});
