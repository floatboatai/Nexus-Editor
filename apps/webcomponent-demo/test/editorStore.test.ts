import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getState, 
  setFilePath, 
  setActiveFile, 
  setContent, 
  setDirty, 
  setError, 
  getEditor, 
  setEditor 
} from '../src/store/editorStore';

describe('editorStore', () => {
  beforeEach(() => {
    setFilePath(null);
    setActiveFile(null);
    setContent('');
    setDirty(false);
    setError(null);
  });

  it('should initialize with default state', () => {
    const state = getState();
    expect(state.filePath).toBeNull();
    expect(state.content).toBe('');
    expect(state.dirty).toBe(false);
    expect(state.error).toBeNull();
    expect(state.activeFile).toBeNull();
  });

  it('should update file path', () => {
    setFilePath('test.md');
    const state = getState();
    expect(state.filePath).toBe('test.md');
  });

  it('should update active file', () => {
    setActiveFile('test.md');
    const state = getState();
    expect(state.activeFile).toBe('test.md');
  });

  it('should update content', () => {
    setContent('# Hello');
    const state = getState();
    expect(state.content).toBe('# Hello');
  });

  it('should update dirty flag', () => {
    setDirty(true);
    const state = getState();
    expect(state.dirty).toBe(true);

    setDirty(false);
    const updatedState = getState();
    expect(updatedState.dirty).toBe(false);
  });

  it('should update error', () => {
    setError('Test error');
    const state = getState();
    expect(state.error).toBe('Test error');

    setError(null);
    const updatedState = getState();
    expect(updatedState.error).toBeNull();
  });

  it('should manage editor instance', () => {
    const mockEditor = { value: 'test' } as any;
    setEditor(mockEditor);
    expect(getEditor()).toBe(mockEditor);
  });
});