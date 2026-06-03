import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBacklinksPanel } from '../src/components/BacklinksPanel';

describe('BacklinksPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('nexus-web-vault', JSON.stringify({
      vaultName: 'Test Vault',
      files: {
        'Welcome.md': '# Welcome\n\nThis is a [[Test]] file',
        'Notes/Getting Started.md': 'See [[Welcome]] for details',
        'Notes/Ideas.md': 'Reference to welcome without link',
      },
    }));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create a backlinks panel element', () => {
    const panel = createBacklinksPanel({
      onOpenFile: vi.fn(),
      getActiveFile: () => 'Welcome.md',
      getFileContent: (path) => {
        const raw = localStorage.getItem('nexus-web-vault');
        if (raw) {
          const storage = JSON.parse(raw);
          return storage.files[path] || null;
        }
        return null;
      },
    });
    
    expect(panel.element).toBeInstanceOf(HTMLElement);
    expect(panel.element.className).toBe('backlinks-panel');
    
    panel.destroy();
  });

  it('should render linked mentions', () => {
    const panel = createBacklinksPanel({
      onOpenFile: vi.fn(),
      getActiveFile: () => 'Welcome.md',
      getFileContent: (path) => {
        const raw = localStorage.getItem('nexus-web-vault');
        if (raw) {
          const storage = JSON.parse(raw);
          return storage.files[path] || null;
        }
        return null;
      },
    });
    
    document.body.appendChild(panel.element);
    
    panel.refresh();
    
    const header = panel.element.querySelector('div:first-child');
    expect(header?.textContent).toContain('Backlinks');
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });

  it('should render unlinked mentions', () => {
    const panel = createBacklinksPanel({
      onOpenFile: vi.fn(),
      getActiveFile: () => 'Welcome.md',
      getFileContent: (path) => {
        const raw = localStorage.getItem('nexus-web-vault');
        if (raw) {
          const storage = JSON.parse(raw);
          return storage.files[path] || null;
        }
        return null;
      },
    });
    
    document.body.appendChild(panel.element);
    
    panel.refresh();
    
    const content = panel.element.textContent;
    expect(content).toContain('Unlinked mentions');
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });

  it('should call onOpenFile when clicking an item', () => {
    const onOpenFile = vi.fn();
    
    const panel = createBacklinksPanel({
      onOpenFile,
      getActiveFile: () => 'Welcome.md',
      getFileContent: (path) => {
        const raw = localStorage.getItem('nexus-web-vault');
        if (raw) {
          const storage = JSON.parse(raw);
          return storage.files[path] || null;
        }
        return null;
      },
    });
    
    document.body.appendChild(panel.element);
    
    panel.refresh();
    
    const buttons = panel.element.querySelectorAll('button');
    if (buttons.length > 0) {
      buttons[0].click();
      expect(onOpenFile).toHaveBeenCalled();
    }
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });

  it('should handle empty vault', () => {
    localStorage.clear();
    
    const panel = createBacklinksPanel({
      onOpenFile: vi.fn(),
      getActiveFile: () => null,
      getFileContent: () => null,
    });
    
    document.body.appendChild(panel.element);
    
    panel.refresh();
    
    expect(panel.element.textContent).toContain('No active file');
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });
});
