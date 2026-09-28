/**
 * excalidraw-scene.ts — shared helpers for `.excalidraw` scene files.
 *
 * Ported from horseMD's `lib/excalidraw-scene.js`: the minimal valid scene
 * used when creating a new whiteboard, and the parse/fallback rule for
 * loaded files. Kept dependency-free so any layer (store, pane, tests) can
 * import it without pulling in the excalidraw bundle.
 */

export const EMPTY_EXCALIDRAW_SCENE = JSON.stringify(
  { type: 'excalidraw', version: 2, source: 'solomd', elements: [], appState: {}, files: {} },
  null,
  2,
);

/** Parsed scene shape handed to the excalidraw component as `initialData`. */
export interface ExcalidrawScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/**
 * Parse scene JSON. Returns null when the file is not a valid excalidraw
 * scene; callers treat null as "blank canvas" (plus a one-shot notice if the
 * file actually had content — that means it was corrupted).
 */
export function parseExcalidrawScene(text: string | undefined | null): ExcalidrawScene | null {
  try {
    const parsed = JSON.parse(text || '');
    if (parsed && parsed.type === 'excalidraw') {
      return {
        elements: parsed.elements || [],
        appState: parsed.appState || {},
        files: parsed.files || {},
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/** True when a tab/file name refers to an excalidraw scene file. */
export function isExcalidrawName(name: string | undefined | null): boolean {
  return /\.excalidraw$/i.test(name || '');
}

// ---- ```excalidraw fences in Markdown ----
//
// A scene can also live INLINE in a note as a fenced block:
//
//     ```excalidraw
//     { ...scene JSON... }
//     ```
//
// Mirrors the ```tldraw fence handling (tldraw-markdown.ts) but simpler: no
// attributes, the body is the whole scene JSON. Fences are matched to preview
// blocks positionally (markdown-it drops nothing here, but the preview
// pipeline already uses positional matching for tldraw).

export interface ExcalidrawFence {
  /** Offset of the fence start (the opening backtick). */
  from: number;
  /** Offset just past the fence end (closing backtick run). */
  to: number;
  /** Pretty-printed scene JSON body (no trailing newline). */
  sceneJson: string;
}

/** Find every ```excalidraw fence in `source`, in document order. */
export function findExcalidrawFences(source: string): ExcalidrawFence[] {
  const out: ExcalidrawFence[] = [];
  const re = /(^|\n)(`{3,})[ \t]*excalidraw[ \t]*\r?\n([\s\S]*?)\r?\n\2(?=\n|$)/g;
  for (const m of source.matchAll(re)) {
    out.push({
      from: m.index! + m[1].length,
      to: m.index! + m[0].length,
      sceneJson: m[3].trim(),
    });
  }
  return out;
}

/**
 * Splice a new scene JSON into the ```excalidraw fence at `index`, returning
 * the updated source. Returns the original unchanged when the fence is gone
 * (deleted out from under a debounced edit — stale-block race guard).
 */
export function replaceExcalidrawFence(source: string, index: number, sceneJson: string): string {
  const fences = findExcalidrawFences(source);
  const target = fences[index];
  if (!target) return source;
  // Keep the original backtick run length so bodies containing backticks
  // never break out of the fence.
  const run = /`{3,}/.exec(source.slice(target.from, target.from + 10))?.[0] ?? '```';
  const rewritten = run + 'excalidraw\n' + sceneJson.trim() + '\n' + run;
  return source.slice(0, target.from) + rewritten + source.slice(target.to);
}
