// HTML document tab helpers — mirrors horseMD's editor-html-view.js: file-type
// detection, the auto-render size ceiling, per-path view-mode persistence
// (render vs source across sessions), and the frame URL for the sandboxed
// render iframe.
import { convertFileSrc } from '@tauri-apps/api/core';

export const HTML_RENDER_MAX_BYTES = 2 * 1024 * 1024;

export function isHtmlName(name: string | undefined | null): boolean {
  if (!name) return false;
  return /\.html?$/i.test(name);
}

/** Too-large documents stay in source view — stuffing tens of MB into a
 *  srcdoc iframe freezes the webview (horseMD has the same 2 MB ceiling). */
export function shouldAutoRenderHtml(content: string): boolean {
  return content.length * 2 <= HTML_RENDER_MAX_BYTES;
}

const LS_KEY = 'solomd.htmlView.v1';

export function loadHtmlViewModes(): Record<string, 'source'> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || '');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveHtmlViewMode(path: string | undefined, mode: 'render' | 'source') {
  if (!path) return;
  try {
    const modes = loadHtmlViewModes();
    const key = path.replace(/\\/g, '/');
    if (mode === 'source') modes[key] = 'source';
    else delete modes[key];
    localStorage.setItem(LS_KEY, JSON.stringify(modes));
  } catch {
    // Persistence is best-effort; view mode is a preference, not data.
  }
}

export function loadHtmlViewMode(path: string | undefined): 'render' | 'source' {
  if (!path) return 'render';
  try {
    return loadHtmlViewModes()[path.replace(/\\/g, '/')] === 'source' ? 'source' : 'render';
  } catch {
    return 'render';
  }
}

/**
 * <base> URL for the srcdoc iframe so relative subresources (images, css,
 * scripts) resolve against the document's folder through Tauri's asset
 * protocol (asset scope is `**` in tauri.conf.json). The directory URL must
 * end with `/` for relative resolution to work.
 */
export function buildHtmlBaseHref(filePath: string | undefined): string {
  if (!filePath) return '';
  const dir = filePath.replace(/[\\/][^\\/]+$/, '');
  if (!dir || dir === filePath) return '';
  const url = convertFileSrc(dir);
  return url.endsWith('/') ? url : url + '/';
}
