export async function createNote(title: string, content: string): Promise<string | null> {
  // Prefer using the renderer bridge `window.nexusDemo.vault` when available
  try {
    // @ts-ignore
    if (typeof window !== 'undefined' && window.nexusDemo && window.nexusDemo.vault) {
      try {
        // Try to get last known vault (may be null)
        // @ts-ignore
        const last = await window.nexusDemo.vault.getLast();
        const vaultPath = last?.lastVault || null;
        const name = `${title.replace(/[^a-z0-9_-]/gi, '_') || 'ai-summary'}.md`;
        if (vaultPath) {
          const personalFolder = `${vaultPath}/personal`;
          try {
            // Ensure folder exists (createFolder may throw if exists)
            // @ts-ignore
            await window.nexusDemo.vault.createFolder(vaultPath, 'personal');
          } catch (e) {
            // ignore, folder may already exist
          }
          try {
            // Create the file (some bridges auto-create parent folders)
            // @ts-ignore
            const created = await window.nexusDemo.vault.createFile(personalFolder, name);
            const filePath = created?.path ?? `${personalFolder}/${name}`;
            // Write content
            // @ts-ignore
            await window.nexusDemo.vault.write(filePath, `# ${title}\n\n${content}\n`);
            return filePath;
          } catch (e) {
            // fallback to writing at vault root
            try {
              // @ts-ignore
              const created = await window.nexusDemo.vault.createFile(vaultPath, name);
              const filePath = created?.path ?? `${vaultPath}/${name}`;
              // @ts-ignore
              await window.nexusDemo.vault.write(filePath, `# ${title}\n\n${content}\n`);
              return filePath;
            } catch (e2) {
              // ignore and fallback
            }
          }
        }
      } catch (e) {
        // ignore and fallback to Node fs
      }
    }

    // Fallback: try Node fs (for scripts/tests)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const folder = path.resolve(process.cwd(), 'apps', 'electron-demo', 'sample-vault', 'personal');
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    const timestamp = Date.now();
    const filename = `${title.replace(/[^a-z0-9_-]/gi, '_') || 'ai-summary'}-${timestamp}.md`;
    const filepath = path.join(folder, filename);
    const md = `# ${title}\n\n${content}\n`;
    fs.writeFileSync(filepath, md, 'utf8');
    return filepath;
  } catch (e) {
    // Cannot write in this environment
    return null;
  }
}
