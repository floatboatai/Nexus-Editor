import React, { useState, useCallback, useRef } from 'react';
import { parseFile } from '../parser';
import { generateImageFromText } from '../AIImageGenerator';
import { createNote } from '../createNote';

type Props = {
  onCreated?: (notePath: string | null) => void;
  onClose?: () => void;
  initialOpen?: boolean;
};

export function AISummaryModal({ onCreated, onClose, initialOpen = true }: Props) {
  const [open, setOpen] = useState<boolean>(initialOpen);
  const [closing, setClosing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const accept = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  const onChoose = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) setFile(f);
  }, []);

  const doProcess = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    try {
      const text = await parseFile(file);
      const img = await generateImageFromText(text);
      setImageUrl(img);
      const title = `AI 摘要 ${new Date().toISOString().slice(0,19).replace(/:/g,'-')}`;
      const notePath = await createNote(title, text);
      if (onCreated) onCreated(notePath);
    } catch (e) {
      // ignore for stub
    } finally {
      setLoading(false);
    }
  }, [file, onCreated]);

  const handleClose = useCallback(() => {
    // play closing animation, then notify host
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      onClose?.();
    }, 220);
  }, [onClose]);

  // Listen for external close requests (e.g. toolbar toggle) so we can animate
  React.useEffect(() => {
    const handler = () => {
      handleClose();
    };
    window.addEventListener('ai-summary-request-close', handler as EventListener);
    return () => window.removeEventListener('ai-summary-request-close', handler as EventListener);
  }, [handleClose]);

  // Reusable modal wrapper component (overlay + centered container)
  const Modal: React.FC<{
    children: React.ReactNode;
    onClose?: () => void;
    width?: number | string;
  }> = ({ children, onClose: onCloseProp, width = 720 }) => {
    const visible = !closing;
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width, maxWidth: '100%', boxSizing: 'border-box', position: 'relative' }}>
          <div style={{
            background: '#fff',
            padding: 20,
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            opacity: visible ? 1 : 0,
            transform: visible ? 'scale(1)' : 'scale(0.985)',
            transition: 'opacity 200ms ease, transform 200ms ease',
            position: 'relative'
          }}>
            <button
              aria-label="Close"
              onClick={onCloseProp}
              style={{ position: 'absolute', right: 12, top: 12, width: 32, height: 32, borderRadius: 6, border: 'none', background: '#f3f4f6', cursor: 'pointer' }}
            >
              ×
            </button>
            {children}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {open && (
        <Modal onClose={handleClose} width={720}>
          <h3 style={{ marginTop: 4 }}>AI 摘要上传（最多 1 个文件）</h3>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              style={{
                border: '2px dashed #ccc',
                padding: 20,
                minHeight: 120,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                gap: 8,
              }}
            >
              {/* hidden input + icon button above the text */}
              <input ref={fileInputRef} accept={accept} type="file" onChange={onChoose} style={{ display: 'none' }} />
              <button
                type="button"
                aria-label="选择文件"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  border: 'none',
                  background: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  cursor: 'pointer',
                }}
              >
                📁
              </button>
              <p style={{ margin: 0, color: '#6b7280' }}>拖拽文件到此处，或使用上方的选择按钮。</p>
              <div style={{ marginTop: 8 }}>
                {file && <div>已选择：{file.name}</div>}
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
              <button
                disabled={!file || loading}
                onClick={doProcess}
                style={{
                  height: 36,
                  padding: '0 14px',
                  fontSize: 14,
                  borderRadius: 6,
                  background: '#6b46c1',
                  color: '#fff',
                  border: 'none',
                  cursor: (!file || loading) ? 'not-allowed' : 'pointer',
                }}
              >
                解析并生成
              </button>
              <button onClick={handleClose} style={{ height: 36, padding: '0 14px', fontSize: 14, borderRadius: 6, background: '#e5e7eb', color: '#111827', border: 'none', cursor: 'pointer' }}>关闭</button>
            </div>

            {loading && <div>处理中…</div>}

            {imageUrl && (
              <div style={{ marginTop: 12 }}>
                <h4>生成图片预览</h4>
                <img src={imageUrl} alt="AI 摘要" style={{ maxWidth: '100%' }} />
              </div>
            )}
        </Modal>
      )}
    </div>
  );
}

export default AISummaryModal;
