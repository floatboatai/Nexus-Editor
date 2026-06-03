import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutlinePanel } from '../src/components/OutlinePanel';

describe('OutlinePanel', () => {
  let mockEditorAPI: any;

  beforeEach(() => {
    mockEditorAPI = {
      getTableOfContents: vi.fn().mockReturnValue([]),
      on: vi.fn(),
      off: vi.fn(),
      setSelection: vi.fn(),
      focus: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create an outline panel element', () => {
    const panel = createOutlinePanel(mockEditorAPI);
    
    expect(panel.element).toBeInstanceOf(HTMLElement);
    expect(panel.element.className).toBe('nexus-outline-panel');
    
    panel.destroy();
  });

  it('should render empty state when no headings', () => {
    mockEditorAPI.getTableOfContents.mockReturnValue([]);
    
    const panel = createOutlinePanel(mockEditorAPI);
    document.body.appendChild(panel.element);
    
    const emptyText = panel.element.textContent;
    expect(emptyText).toContain('No headings');
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });

  it('should render headings from table of contents', () => {
    mockEditorAPI.getTableOfContents.mockReturnValue([
      { text: 'Heading 1', level: 1, from: 0, to: 10 },
      { text: 'Heading 2', level: 2, from: 10, to: 20 },
    ]);
    
    const panel = createOutlinePanel(mockEditorAPI);
    document.body.appendChild(panel.element);
    
    const buttons = panel.element.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Heading 1');
    expect(buttons[1].textContent).toBe('Heading 2');
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });

  it('should update when called', () => {
    mockEditorAPI.getTableOfContents.mockReturnValue([
      { text: 'Updated Heading', level: 1, from: 0, to: 15 },
    ]);
    
    const panel = createOutlinePanel(mockEditorAPI);
    
    panel.update();
    
    expect(mockEditorAPI.getTableOfContents).toHaveBeenCalled();
    
    panel.destroy();
  });

  it('should navigate to heading when clicked', () => {
    const tocEntry = { text: 'Test Heading', level: 1, from: 0, to: 10 };
    mockEditorAPI.getTableOfContents.mockReturnValue([tocEntry]);
    
    const panel = createOutlinePanel(mockEditorAPI);
    document.body.appendChild(panel.element);
    
    const button = panel.element.querySelector('button');
    button?.click();
    
    expect(mockEditorAPI.setSelection).toHaveBeenCalledWith(0);
    expect(mockEditorAPI.focus).toHaveBeenCalled();
    
    panel.destroy();
    document.body.removeChild(panel.element);
  });
});
