import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderStatus } from '../src/components/StatusBar';
import { setFilePath, setContent, setDirty, setError } from '../src/store/editorStore';

describe('StatusBar', () => {
  let statusLine: HTMLElement;

  beforeEach(() => {
    statusLine = document.createElement('div');
    statusLine.id = 'status-line';
    document.body.appendChild(statusLine);
    
    setFilePath(null);
    setContent('');
    setDirty(false);
    setError(null);
  });

  afterEach(() => {
    document.body.removeChild(statusLine);
  });

  it('should render default status', () => {
    renderStatus();
    expect(statusLine.textContent).toContain('Untitled');
  });

  it('should render file path when set', () => {
    setFilePath('test.md');
    renderStatus();
    expect(statusLine.textContent).toContain('test.md');
  });

  it('should show modified indicator when dirty', () => {
    setDirty(true);
    renderStatus();
    expect(statusLine.textContent).toContain('[modified]');
  });

  it('should show word and line counts', () => {
    setContent('# Hello\nWorld');
    renderStatus();
    expect(statusLine.textContent).toContain('words');
    expect(statusLine.textContent).toContain('lines');
  });

  it('should show error when set', () => {
    setError('Test error');
    renderStatus();
    expect(statusLine.textContent).toContain('Error: Test error');
  });
});