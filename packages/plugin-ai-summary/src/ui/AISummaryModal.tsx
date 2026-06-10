import React, { useState, useCallback } from 'react';
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
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const accept = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md';

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
    setOpen(false);
    onClose?.();
  }, [onClose]);

  return (
    <div>
      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: 720, maxWidth: '100%', background: '#fff', padding: 20, borderRadius: 8, boxSizing: 'border-box', boxShadow: '0 10px 30px rgba(0,0,0,0.35)' }}>
            <h3>AI 摘要上传（最多 1 个文件）</h3>
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
              <p style={{ margin: 0 }}>拖拽文件到此处，或使用下面的选择按钮。</p>
              <input accept={accept} type="file" onChange={onChoose} />
              <div style={{ marginTop: 8 }}>
                {file && <div>已选择：{file.name}</div>}
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
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
              <button
                onClick={handleClose}
                style={{
                  marginLeft: 8,
                  height: 36,
                  padding: '0 14px',
                  fontSize: 14,
                  borderRadius: 6,
                  background: '#e5e7eb',
                  color: '#111827',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                关闭
              </button>
            </div>

            {loading && <div>处理中…</div>}

            {imageUrl && (
              <div style={{ marginTop: 12 }}>
                <h4>生成图片预览</h4>
                <img src={imageUrl} alt="AI 摘要" style={{ maxWidth: '100%' }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AISummaryModal;
