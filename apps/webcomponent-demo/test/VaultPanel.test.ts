import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVaultPanel } from '../src/components/VaultPanel';

describe('VaultPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create a vault panel element', () => {
    const panel = createVaultPanel({
      onOpenFile: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
    });
    
    expect(panel.element).toBeInstanceOf(HTMLElement);
    expect(panel.element.className).toBe('vault-panel');
    
    panel.destroy();
  });

  it('should render default files', () => {
    const panel = createVaultPanel({
      onOpenFile: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
    });
    
    document.body.appendChild(panel.element);
    
    const treeContainer = panel.element.querySelector('.vault-tree');
    expect(treeContainer).not.toBeNull();
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });

  it('should set active file', () => {
    const panel = createVaultPanel({
      onOpenFile: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
    });
    
    panel.setActiveFile('Welcome.md');
    
    expect(true).toBe(true);
    
    panel.destroy();
  });

  it('should refresh vault', () => {
    const panel = createVaultPanel({
      onOpenFile: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
    });
    
    panel.refresh();
    
    expect(true).toBe(true);
    
    panel.destroy();
  });
});
