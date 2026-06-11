import React, { useState, useCallback, useRef } from 'react';
import { parseFile, clearParseCache } from '../parser';
import { generateImageFromText, clearImageCache } from '../AIImageGenerator';
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
  const [showConnectors, setShowConnectors] = useState(true);
  const [useCache, setUseCache] = useState(true);

  const accept = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) {
      // clear previous generated image when a new file is provided
      setImageUrl(null);
      setFile(f);
    }
  }, []);

  const onChoose = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) {
      // clear previous generated image when a new file is chosen
      setImageUrl(null);
      setFile(f);
    }
  }, []);

  const doProcess = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    try {
      const text = await parseFile(file);
      const img = await generateImageFromText(text, { connectors: showConnectors });
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

  const downloadImage = useCallback(() => {
    if (!imageUrl) return;
    try {
      const a = document.createElement('a');
      a.href = imageUrl;
      const ext = imageUrl.startsWith('data:image/svg+xml') ? 'svg' : 'png';
      const name = `ai-summary-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.${ext}`;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      // ignore
    }
  }, [imageUrl]);

  // Convert data URL (SVG) to Blob
  const dataURLToBlob = useCallback((dataUrl: string): Blob | null => {
    try {
      const parts = dataUrl.split(',');
      const meta = parts[0];
      const isBase64 = /;base64$/.test(meta) || /;base64;/.test(meta);
      const mimeMatch = meta.match(/:(.*?);/);
      const mime = (mimeMatch && mimeMatch[1]) || 'application/octet-stream';
      if (isBase64) {
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8 = new Uint8Array(n);
        while (n--) u8[n] = bstr.charCodeAt(n);
        return new Blob([u8], { type: mime });
      }
      // not base64
      return new Blob([decodeURIComponent(parts[1])], { type: mime });
    } catch (e) {
      return null;
    }
  }, []);

  // Render SVG data URL to PNG data URL using canvas (browser)
  const svgDataUrlToPngDataUrl = useCallback((svgDataUrl: string, scale = 1): Promise<string> => {
    return new Promise((resolve, reject) => {
      try {
        const blob = dataURLToBlob(svgDataUrl);
        if (!blob) return reject(new Error('Invalid SVG'));
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          try {
            const cw = Math.max(1, Math.floor(img.width * scale));
            const ch = Math.max(1, Math.floor(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('No 2D context'));
            // fill background as transparent, then draw
            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            const png = canvas.toDataURL('image/png');
            URL.revokeObjectURL(url);
            resolve(png);
          } catch (err) {
            URL.revokeObjectURL(url);
            reject(err);
          }
        };
        img.onerror = (ev) => {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to load SVG image'));
        };
        // Use anonymous to reduce CORS issues for data URLs
        img.crossOrigin = 'anonymous';
        img.src = url;
      } catch (e) {
        reject(e);
      }
    });
  }, [dataURLToBlob]);

  // Save image to vault if bridge available, otherwise trigger download
  const saveImageToVaultOrDownload = useCallback(async (dataUrl: string, preferPng = true) => {
    // preferPng: if true, try to convert to PNG
    try {
      let outDataUrl = dataUrl;
      if (preferPng && dataUrl.startsWith('data:image/svg+xml')) {
        try {
          outDataUrl = await svgDataUrlToPngDataUrl(dataUrl, 1);
        } catch (e) {
          // fallback to svg
          outDataUrl = dataUrl;
        }
      }

      // Attempt to save via host bridge
      // @ts-ignore
      if (typeof window !== 'undefined' && (window as any).nexusDemo && (window as any).nexusDemo.vault) {
        try {
          // get vault root
          // @ts-ignore
          const last = await (window as any).nexusDemo.vault.getLast();
          const vaultPath = last?.lastVault || null;
          const name = `ai-summary-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.${outDataUrl.startsWith('data:image/png') ? 'png' : 'svg'}`;
          if (vaultPath) {
            const personalFolder = `${vaultPath}/personal`;
            try {
              // @ts-ignore
              await (window as any).nexusDemo.vault.createFolder(vaultPath, 'personal');
            } catch (e) {}
            try {
              // create file
              // @ts-ignore
              const created = await (window as any).nexusDemo.vault.createFile(personalFolder, name);
              const path = created?.path ?? `${personalFolder}/${name}`;
              // Try writing raw binary if supported
              const blob = dataURLToBlob(outDataUrl);
              if (blob) {
                // Some bridges accept ArrayBuffer/Uint8Array
                const arr = new Uint8Array(await blob.arrayBuffer());
                // @ts-ignore
                await (window as any).nexusDemo.vault.write(path, arr);
              } else {
                // fallback to data URL text
                // @ts-ignore
                await (window as any).nexusDemo.vault.write(path, outDataUrl);
              }
              return path;
            } catch (e) {
              // fallback to download
            }
          }
        } catch (e) {
          // continue to download fallback
        }
      }

      // Fallback: trigger download
      const a = document.createElement('a');
      a.href = outDataUrl;
      const ext = outDataUrl.startsWith('data:image/png') ? 'png' : 'svg';
      a.download = `ai-summary-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return null;
    } catch (e) {
      // ignore
      return null;
    }
  }, [dataURLToBlob, svgDataUrlToPngDataUrl]);

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

  // Keyboard shortcuts: Esc closes modal; Enter triggers generate when file selected and not loading
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter') {
        if (!loading && file && !imageUrl) {
          doProcess();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose, loading, file, imageUrl, doProcess]);

  // Reusable modal wrapper component (overlay + centered container)
  const Modal: React.FC<{
    children: React.ReactNode;
    onClose?: () => void;
    width?: number | string;
  }> = ({ children, onClose: onCloseProp, width = 720 }) => {
    const visible = !closing;
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width, maxWidth: '80vw', maxHeight: '80vh', boxSizing: 'border-box', position: 'relative' }}>
          <div style={{
            background: '#fff',
            padding: 0,
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            opacity: visible ? 1 : 0,
            transform: visible ? 'scale(1)' : 'scale(0.985)',
            transition: 'opacity 200ms ease, transform 200ms ease',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '80vh',
            overflow: 'hidden'
          }}>
            <button
              aria-label="Close"
              onClick={onCloseProp}
              style={{ position: 'absolute', right: 12, top: 12, width: 32, height: 32, borderRadius: 8, border: 'none', background: '#f3f4f6', cursor: 'pointer' }}
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
          <div style={{ padding: 16, borderBottom: '1px solid #e6e6e6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ margin: 0 }}>AI 摘要上传</h3>
          </div>

          <div style={{ padding: 16, flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch', justifyContent: 'flex-start' }}>
              {!imageUrl ? (
                <>
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDrop}
                    style={{
                      border: '1px dashed #e5e7eb',
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
                    <p style={{ margin: 0, color: '#6b7280' }}>拖拽文件到此处，或使用上方的选择按钮。最多 1 个文件。</p>
                    <div style={{ marginTop: 8 }}>
                      {file && <div>已选择：{file.name}</div>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                    <button
                      disabled={!file || loading}
                      onClick={doProcess}
                      style={{
                        height: 36,
                        padding: '0 14px',
                        fontSize: 14,
                        borderRadius: 8,
                        background: '#6b46c1',
                        color: '#fff',
                        border: 'none',
                        cursor: (!file || loading) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      解析并生成
                    </button>
                    {/* <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#374151' }}>
                      <input type='checkbox' checked={showConnectors} onChange={(e) => setShowConnectors(e.target.checked)} /> 显示连线
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#374151' }}>
                      <input type='checkbox' checked={useCache} onChange={(e) => setUseCache(e.target.checked)} /> 使用缓存
                    </label>
                    <button onClick={() => { clearParseCache(); clearImageCache(); setImageUrl(null); }} style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#fff', color: '#111827', cursor: 'pointer' }}>清除缓存</button> */}
                    <button onClick={handleClose} style={{ height: 36, padding: '0 14px', fontSize: 14, borderRadius: 8, background: '#e5e7eb', color: '#111827', border: 'none', cursor: 'pointer' }}>关闭</button>
                  </div>

                  {loading && <div>处理中…</div>}
                </>
              ) : null}

              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', width: '100%' }}>
                {imageUrl && (
                  <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: 900, overflow: 'hidden'}}>
                      {/* title outside of scaled area */}
                      <h4 style={{ color: '#111827', margin: '8px 0 8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>生成图片预览</span>
                        <div style={{ marginLeft: 12 }}>
                            {/* <button aria-label="重新生成" onClick={doProcess} style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#fff', color: '#111827', cursor: 'pointer', marginRight: 8 }}>重新生成</button>
                          <button aria-label="另存为" onClick={async () => { if (imageUrl) await saveImageToVaultOrDownload(imageUrl, true); }} style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#f3f4f6', color: '#111827', cursor: 'pointer', marginRight: 8 }}>另存为</button> */}
                          <button aria-label="下载" onClick={downloadImage} style={{ height: 36, width: 36, borderRadius: 8, border: '1px solid #e6e6e6', background: '#f3f4f6', color: '#111827', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⬇</button>
                        </div>
                      </h4>

                      {/* viewport adapts to modal height; image fills width and vertical overflow becomes scrollable */}
                      <div style={{ width: '100%', maxWidth: '100%', maxHeight: '60vh', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 0, boxSizing: 'border-box' }}>
                        <div style={{ width: '100%', boxSizing: 'border-box' }}>
                          <img src={imageUrl} alt="AI 摘要" style={{ width: '100%', height: 'auto', display: 'block' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default AISummaryModal;
