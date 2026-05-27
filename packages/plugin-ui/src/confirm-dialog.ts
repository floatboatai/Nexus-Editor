export interface AIAnswerOption {
  text: string;
  label: string;
}

export interface AIResponse {
  thinking: string;
  options: AIAnswerOption[];
}

export interface ConfirmDialogOptions {
  title: string;
  originalText: string;
  onConfirm: (selectedOption: AIAnswerOption) => void;
  onCancel: () => void;
}

export interface ConfirmDialog {
  element: HTMLElement;
  updateStreamingText: (text: string) => void;
  updateAIResponse: (response: AIResponse) => void;
  setLoading: (loading: boolean) => void;
  destroy: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const DIALOG_STYLES = `
  .nexus-ai-dialog {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .nexus-ai-dialog-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }

  .nexus-ai-dialog-content {
    position: relative;
    width: 90%;
    max-width: 900px;
    max-height: 90vh;
    background: var(--nexus-bg, #ffffff);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(20px);
    }
    to { 
      opacity: 1;
      transform: translateY(0);
    }
  }

  .nexus-ai-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--nexus-border, #e5e7eb);
    background: var(--nexus-bg-subtle, #f9fafb);
  }

  .nexus-ai-dialog-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--nexus-text, #111827);
  }

  .nexus-ai-dialog-close {
    background: transparent;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--nexus-text-muted, #6b7280);
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.15s;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nexus-ai-dialog-close:hover {
    background: var(--nexus-bg-muted, #f3f4f6);
    color: var(--nexus-text, #111827);
  }

  .nexus-ai-dialog-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .nexus-ai-text-section {
    display: flex;
    flex-direction: column;
    background: var(--nexus-bg-subtle, #f9fafb);
    border-radius: 8px;
    overflow: hidden;
    max-height: 500px;
  }

  .nexus-ai-polished-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 500px;
    overflow-y: auto;
  }

  .nexus-ai-text-section label,
  .nexus-ai-polished-section label {
    font-size: 13px;
    font-weight: 500;
    color: var(--nexus-text-muted, #6b7280);
    padding: 10px 12px;
    border-bottom: 1px solid var(--nexus-border, #e5e7eb);
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--nexus-bg-muted, #f3f4f6);
    border-radius: 8px 8px 0 0;
  }

  .nexus-ai-polished-section label {
    border-radius: 8px;
  }

  .nexus-ai-loading {
    font-size: 12px;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .nexus-ai-original {
    flex: 1;
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-y: auto;
    max-height: 450px;
    margin: 0;
    color: var(--nexus-text-muted, #6b7280);
    background: transparent;
  }

  .nexus-ai-thinking {
    margin-bottom: 12px;
    font-size: 12px;
    color: #9ca3af;
    line-height: 1.6;
    padding: 12px;
    background: var(--nexus-bg-subtle, #f9fafb);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .nexus-ai-thinking:empty {
    display: none;
  }

  .nexus-ai-streaming {
    font-size: 13px;
    line-height: 1.6;
    padding: 12px;
    background: var(--nexus-bg-subtle, #f9fafb);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--nexus-text, #111827);
    min-height: 100px;
  }

  .nexus-ai-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .nexus-ai-option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: var(--nexus-bg-subtle, #f9fafb);
    border: 2px solid var(--nexus-border, #e5e7eb);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .nexus-ai-option:hover {
    border-color: var(--nexus-accent, #3b82f6);
    background: rgba(59, 130, 246, 0.03);
  }

  .nexus-ai-option.selected {
    border-color: var(--nexus-accent, #3b82f6);
    background: rgba(59, 130, 246, 0.08);
  }

  .nexus-ai-option input[type="radio"] {
    margin-top: 4px;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    accent-color: var(--nexus-accent, #3b82f6);
  }

  .nexus-ai-option-content {
    flex: 1;
    min-width: 0;
  }

  .nexus-ai-option-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--nexus-accent, #3b82f6);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .nexus-ai-option-text {
    font-size: 13px;
    line-height: 1.6;
    color: var(--nexus-text, #111827);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .nexus-ai-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid var(--nexus-border, #e5e7eb);
    background: var(--nexus-bg-subtle, #f9fafb);
  }

  .nexus-ai-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .nexus-ai-btn-cancel {
    background: transparent;
    color: var(--nexus-text, #111827);
    border: 1px solid var(--nexus-border, #e5e7eb);
  }

  .nexus-ai-btn-cancel:hover {
    background: var(--nexus-bg-muted, #f3f4f6);
  }

  .nexus-ai-btn-confirm {
    background: var(--nexus-accent, #3b82f6);
    color: white;
  }

  .nexus-ai-btn-confirm:hover:not(:disabled) {
    background: var(--nexus-accent-hover, #2563eb);
  }

  .nexus-ai-btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .nexus-ai-dialog-body {
      grid-template-columns: 1fr;
    }
  }
`;

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  
  const styleSheet = document.createElement('style');
  styleSheet.textContent = DIALOG_STYLES;
  document.head.appendChild(styleSheet);
  stylesInjected = true;
}

export function createConfirmDialog(options: ConfirmDialogOptions): ConfirmDialog {
  injectStyles();

  const dialog = document.createElement('div');
  dialog.className = 'nexus-ai-dialog';
  dialog.innerHTML = `
    <div class="nexus-ai-dialog-overlay"></div>
    <div class="nexus-ai-dialog-content">
      <div class="nexus-ai-dialog-header">
        <h3>${escapeHtml(options.title)}</h3>
        <button class="nexus-ai-dialog-close" aria-label="Close">&times;</button>
      </div>
      <div class="nexus-ai-dialog-body">
        <div class="nexus-ai-text-section">
          <label>原文</label>
          <pre class="nexus-ai-original">${escapeHtml(options.originalText)}</pre>
        </div>
        <div class="nexus-ai-polished-section">
          <label>润色方案 <span class="nexus-ai-loading">⏳</span></label>
          <div class="nexus-ai-streaming" id="streaming"></div>
          <div id="formatted-content" style="display: none;">
            <div class="nexus-ai-thinking" id="thinking"></div>
            <div class="nexus-ai-options" id="options"></div>
          </div>
        </div>
      </div>
      <div class="nexus-ai-dialog-footer">
        <button class="nexus-ai-btn nexus-ai-btn-cancel">取消</button>
        <button class="nexus-ai-btn nexus-ai-btn-confirm" disabled>确定</button>
      </div>
    </div>
  `;

  const streamingEl = dialog.querySelector('#streaming') as HTMLElement;
  const formattedContentEl = dialog.querySelector('#formatted-content') as HTMLElement;
  const thinkingEl = dialog.querySelector('#thinking') as HTMLElement;
  const optionsEl = dialog.querySelector('#options') as HTMLElement;
  const confirmBtn = dialog.querySelector('.nexus-ai-btn-confirm') as HTMLButtonElement;
  const loadingEl = dialog.querySelector('.nexus-ai-loading') as HTMLElement;
  
  let selectedOption: AIAnswerOption | null = null;

  const handleCancel = () => {
    options.onCancel();
  };

  dialog.querySelector('.nexus-ai-dialog-close')?.addEventListener('click', handleCancel);
  dialog.querySelector('.nexus-ai-dialog-overlay')?.addEventListener('click', handleCancel);
  dialog.querySelector('.nexus-ai-btn-cancel')?.addEventListener('click', handleCancel);
  
  confirmBtn.addEventListener('click', () => {
    if (selectedOption) {
      options.onConfirm(selectedOption);
    }
  });

  const cleanup = () => {
    dialog.remove();
  };

  return {
    element: dialog,
    updateStreamingText(text: string) {
      streamingEl.textContent = text;
      streamingEl.style.display = 'block';
      formattedContentEl.style.display = 'none';
    },
    updateAIResponse(response: AIResponse) {
      streamingEl.style.display = 'none';
      formattedContentEl.style.display = 'block';
      
      thinkingEl.textContent = response.thinking;
      optionsEl.innerHTML = '';
      
      response.options.forEach((option, index) => {
        const optionEl = document.createElement('div');
        optionEl.className = `nexus-ai-option${index === 0 ? ' selected' : ''}`;
        optionEl.innerHTML = `
          <input type="radio" name="ai-option" value="${index}" ${index === 0 ? 'checked' : ''}>
          <div class="nexus-ai-option-content">
            <div class="nexus-ai-option-label">【${escapeHtml(option.label)}】</div>
            <div class="nexus-ai-option-text">${escapeHtml(option.text)}</div>
          </div>
        `;
        
        optionEl.addEventListener('click', () => {
          dialog.querySelectorAll('.nexus-ai-option').forEach(el => {
            el.classList.remove('selected');
          });
          dialog.querySelectorAll('input[name="ai-option"]').forEach(input => {
            (input as HTMLInputElement).checked = false;
          });
          const radioInput = optionEl.querySelector('input[name="ai-option"]') as HTMLInputElement;
          radioInput.checked = true;
          optionEl.classList.add('selected');
          selectedOption = option;
          confirmBtn.disabled = false;
        });
        
        optionsEl.appendChild(optionEl);
        
        if (index === 0) {
          selectedOption = option;
          confirmBtn.disabled = false;
        }
      });
    },
    setLoading(loading: boolean) {
      loadingEl.style.display = loading ? 'inline-block' : 'none';
    },
    destroy: cleanup,
  };
}
