// apps/electron-demo/src/renderer/i18n.ts

export type Language = 'en' | 'zh-CN';

interface TranslationMap {
  [key: string]: string | { [key: string]: string };
}

const resources: Record<Language, TranslationMap> = {
  'en': {
    // ---- 通用 ----
    'app.title': 'Nexus Editor Demo',
    'app.untitled': 'Untitled',
    'app.modified': '[modified]',
    'app.vault': 'Vault',
    'app.open': 'Open',
    'app.save': 'Save',
    'app.saveAs': 'Save As',
    'app.recentFiles': 'Recent Files',
    'app.noRecentFiles': 'No recent files',
    'app.settings': 'Settings',
    'app.search': 'Search (Ctrl+F)',
    'app.toggleVault': 'Toggle vault panel',
    'app.toggleOutline': 'Toggle outline',
    'app.toggleBacklinks': 'Toggle backlinks panel',
    'app.status.vault': 'Vault: {name}',
    'app.status.error': 'Error: {message}',
    'app.status.stats': '{words} words, {lines} lines',
    // ---- 确认对话框 ----
    'confirm.dirty.title': 'You have unsaved changes. What would you like to do?',
    'confirm.dirty.save': 'Save & Switch',
    'confirm.dirty.discard': 'Discard & Switch',
    'confirm.dirty.cancel': 'Cancel',
    // ---- 设置面板 ----
    'settings.title': 'Settings',
    'settings.reset': 'Reset to Default',
    'settings.resetConfirm': 'Reset all settings to default values?',
    'settings.close': 'Close (Esc)',
    'settings.display': 'Display',
    'settings.colorScheme': 'Color scheme',
    'settings.colorScheme.desc': 'Light or dark theme',
    'settings.lineNumbers': 'Line numbers',
    'settings.lineNumbers.desc': 'Show line numbers in the gutter',
    'settings.livePreview': 'Live preview',
    'settings.livePreview.desc': 'Render markdown in real-time',
    'settings.indentGuides': 'Indent guides',
    'settings.indentGuides.desc': 'Show indentation guide lines',
    'settings.contentMaxWidth': 'Content max width',
    'settings.contentMaxWidth.desc': 'Limit line width for readability (e.g. 720px)',
    'settings.direction': 'Text direction',
    'settings.direction.desc': 'Left-to-right or right-to-left',
    'settings.font': 'Font',
    'settings.fontSize': 'Font size',
    'settings.fontSize.desc': 'Editor text size in pixels',
    'settings.bodyFont': 'Body font',
    'settings.bodyFont.desc': 'Font for prose content',
    'settings.codeFont': 'Code font',
    'settings.codeFont.desc': 'Monospace font for code blocks',
    'settings.behavior': 'Behavior',
    'settings.tabSize': 'Tab size',
    'settings.tabSize.desc': 'Number of spaces per tab',
    'settings.language': 'Language',
    'settings.language.desc': 'UI language',
    // 语言名称（用于下拉选项）
    'lang.en': 'English',
    'lang.zh-CN': '简体中文',
  },
  'zh-CN': {
    'app.title': 'Nexus 编辑器演示',
    'app.untitled': '未命名',
    'app.modified': '[已修改]',
    'app.vault': '仓库',
    'app.open': '打开',
    'app.save': '保存',
    'app.saveAs': '另存为',
    'app.recentFiles': '最近文件',
    'app.noRecentFiles': '暂无最近文件',
    'app.settings': '设置',
    'app.search': '搜索 (Ctrl+F)',
    'app.toggleVault': '切换仓库面板',
    'app.toggleOutline': '切换大纲',
    'app.toggleBacklinks': '切换反向链接面板',
    'app.status.vault': '仓库: {name}',
    'app.status.error': '错误: {message}',
    'app.status.stats': '{words} 字, {lines} 行',
    'confirm.dirty.title': '您有未保存的更改，请选择：',
    'confirm.dirty.save': '保存并切换',
    'confirm.dirty.discard': '放弃并切换',
    'confirm.dirty.cancel': '取消',
    'settings.title': '设置',
    'settings.reset': '恢复默认',
    'settings.resetConfirm': '确定要恢复所有设置为默认值吗？',
    'settings.close': '关闭 (Esc)',
    'settings.display': '显示',
    'settings.colorScheme': '颜色主题',
    'settings.colorScheme.desc': '浅色或深色主题',
    'settings.lineNumbers': '行号',
    'settings.lineNumbers.desc': '在边栏显示行号',
    'settings.livePreview': '实时预览',
    'settings.livePreview.desc': '实时渲染 Markdown',
    'settings.indentGuides': '缩进参考线',
    'settings.indentGuides.desc': '显示缩进参考线',
    'settings.contentMaxWidth': '内容最大宽度',
    'settings.contentMaxWidth.desc': '限制行宽以提高可读性 (例如 720px)',
    'settings.direction': '文字方向',
    'settings.direction.desc': '从左到右或从右到左',
    'settings.font': '字体',
    'settings.fontSize': '字号',
    'settings.fontSize.desc': '编辑器文字大小 (像素)',
    'settings.bodyFont': '正文字体',
    'settings.bodyFont.desc': '正文内容的字体',
    'settings.codeFont': '代码字体',
    'settings.codeFont.desc': '代码块的等宽字体',
    'settings.behavior': '行为',
    'settings.tabSize': 'Tab 大小',
    'settings.tabSize.desc': '每个 Tab 对应的空格数',
    'settings.language': '语言',
    'settings.language.desc': '界面语言',
    'lang.en': 'English',
    'lang.zh-CN': '简体中文',
  }
};

// ---- 当前语言和翻译函数 ----
let currentLanguage: Language = 'en';

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
  // 触发所有监听器（可选），这里简单处理，UI 更新依赖重新渲染
}

export function t(key: string, params?: Record<string, string | number>): string {
  const langDict = resources[currentLanguage] || resources['en'];
  let template = langDict[key];
  if (!template) {
    // fallback to English
    const enDict = resources['en'];
    template = enDict[key] || key;
  }
  if (typeof template !== 'string') {
    return key;
  }
  if (params) {
    return template.replace(/\{(\w+)\}/g, (_, p) => String(params[p] ?? ''));
  }
  return template;
}

// 获取所有支持的语言列表（用于设置下拉）
export function getSupportedLanguages(): { value: Language; label: string }[] {
  return [
    { value: 'en', label: t('lang.en') },
    { value: 'zh-CN', label: t('lang.zh-CN') },
  ];
}