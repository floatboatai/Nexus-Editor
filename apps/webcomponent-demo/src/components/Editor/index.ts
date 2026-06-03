import './Editor.css';
import { setEditor, setContent, setDirty } from '../../store/editorStore';
import type { NexusEditor } from '../../types';

const DEFAULT_CONTENT = `# Welcome to Nexus Editor

This is a **Markdown** editor demo.

## Features

- Real-time preview
- GFM support
- Keyboard shortcuts
- Search functionality
- Wiki links (\`[[page]]\`)

## Code Example

\`\`\`javascript
const editor = document.querySelector('nexus-editor');
editor.value = '# Hello';
\`\`\`

## Task List

- [x] Basic editing
- [x] Formatting
- [x] Search
- [ ] Advanced features

## Wiki Links

Try creating wiki links: [[My Note]]
`;

export interface Editor {
  element: NexusEditor;
  destroy(): void;
}

export function createEditor(container: HTMLElement): Editor {
  const nexusEditor = document.createElement('nexus-editor') as NexusEditor;
  nexusEditor.setAttribute('theme', 'light');
  nexusEditor.value = DEFAULT_CONTENT;
  
  container.appendChild(nexusEditor);
  
  setContent(nexusEditor.value);
  setEditor(nexusEditor);
  
  function handleChange(e: Event) {
    const event = e as CustomEvent<{ value: string }>;
    setContent(event.detail.value);
    setDirty(true);
  }
  
  nexusEditor.addEventListener('change', handleChange);
  
  return {
    element: nexusEditor,
    destroy() {
      nexusEditor.removeEventListener('change', handleChange);
      nexusEditor.remove();
    },
  };
}
