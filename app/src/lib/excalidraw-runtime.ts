/**
 * excalidraw-runtime.ts — THE single dynamic-import adapter for
 * `@excalidraw/excalidraw`, mirroring `tldraw-runtime.ts`.
 *
 * Excalidraw is a React library (heavy: component + fonts + CSS) and SoloMD
 * is Vue3. Every `@excalidraw/excalidraw` / `react` / `react-dom` import in
 * the whole codebase is confined to THIS file and performed via dynamic
 * `import()`, so the bundle stays code-split and the rest of the app never
 * evaluates the excalidraw chunk until an `.excalidraw` tab actually mounts.
 *
 * The public surface is framework-agnostic: `mountExcalidraw(el, opts)`
 * mounts a live excalidraw editor into a raw DOM node and returns an
 * `ExcalidrawHandle` with `getSceneJson` / `exportPng` / `exportSvg` /
 * `destroy`. Callers (ExcalidrawPane.vue) never touch React or excalidraw
 * types directly.
 *
 * Behavior ported from horseMD's ExcalidrawEditor.jsx:
 *   - baseline de-dupe: excalidraw fires several onChange bursts while
 *     mounting (restore, font load, appState init). The first observed
 *     serialization becomes the baseline; anything identical to the last
 *     baseline never publishes, so untouched reopen and viewport churn
 *     never mark the tab dirty.
 *   - unmount flush: a pending debounced edit (< window old) is flushed
 *     synchronously on destroy so closing/switching cannot lose it.
 *   - excalidraw's own persistence paths (loadScene / export dialog's
 *     save-to-disk) are disabled — the host save flow (Cmd+S) owns
 *     persistence via tab.content.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ExcalidrawScene } from './excalidraw-scene';

export interface MountExcalidrawOptions {
  /** Initial scene parsed by `parseExcalidrawScene` (null = blank canvas). */
  scene: ExcalidrawScene | null;
  /** Debounce window for onSceneChange in ms (default 500, like horseMD). */
  debounceMs?: number;
  /**
   * Fired (debounced) when the user edits the scene. The argument is the
   * `serializeAsJSON` output — stable for an untouched scene.
   */
  onSceneChange?: (sceneJson: string) => void;
}

export interface ExcalidrawHandle {
  /** Serialize the LIVE scene; null only when serialization genuinely fails. */
  getSceneJson(): string | null;
  /** Export the current scene as a PNG blob. */
  exportPng(): Promise<Blob>;
  /** Export the current scene as an SVG string. */
  exportSvg(): Promise<string>;
  /** Tear the board + React root down. MUST be called on pane unmount. */
  destroy(): void;
}

// Cache the dynamic imports so re-mounting doesn't re-fetch the heavy chunk.
let modsPromise: Promise<any> | null = null;
async function loadMods(): Promise<any> {
  if (!modsPromise) {
    modsPromise = (async () => {
      const [ExcalidrawPkg, React, ReactDOMClient] = await Promise.all([
        import('@excalidraw/excalidraw'),
        import('react'),
        import('react-dom/client'),
      ]);
      // Excalidraw ships its CSS separately; load it once (best-effort).
      try {
        await import('@excalidraw/excalidraw/index.css');
      } catch {
        /* css import is best-effort */
      }
      return { ExcalidrawPkg, React, ReactDOMClient };
    })();
  }
  return modsPromise;
}

/**
 * Render an excalidraw scene to a static SVG string for the preview / reading
 * / export surfaces (non-interactive, printable). Uses the pure `exportToSvg`
 * helper — no React mount needed. Returns null when the scene is empty.
 */
export async function sceneToSvg(scene: ExcalidrawScene): Promise<string | null> {
  if (!scene.elements.length) return null;
  const { ExcalidrawPkg } = await loadMods();
  try {
    const svg = await ExcalidrawPkg.exportToSvg({
      elements: scene.elements as any,
      appState: scene.appState as any,
      files: scene.files as any,
    });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return null;
  }
}

/**
 * Mount a live excalidraw editor into `el`. Returns a handle the caller
 * drives. All excalidraw/React interaction is contained here.
 */
export async function mountExcalidraw(
  el: HTMLElement,
  opts: MountExcalidrawOptions,
): Promise<ExcalidrawHandle> {
  const { ExcalidrawPkg, React, ReactDOMClient } = await loadMods();
  const { Excalidraw, serializeAsJSON, exportToBlob, exportToSvg } = ExcalidrawPkg;

  const debounceMs = opts.debounceMs ?? 500;
  const initial = opts.scene;

  // Latest observed scene parts + last published serialization.
  let latest: { elements: any[]; appState: any; files: any } = initial || {
    elements: [],
    appState: {},
    files: {},
  };
  let lastBaseline: string | null = null;

  const serializeScene = (): string =>
    serializeAsJSON(latest.elements, latest.appState, latest.files, 'local');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handleSceneChange = (elements: any[], appState: any, files: any) => {
    latest = { elements, appState, files };
    try {
      const json = serializeScene();
      if (lastBaseline === null) {
        // First observation after mount: baseline, not an edit.
        lastBaseline = json;
        return;
      }
    } catch {
      // Fall through to the debounced path; serialization is retried there.
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        const json = serializeScene();
        if (json === lastBaseline) return;
        lastBaseline = json;
        opts.onSceneChange?.(json);
      } catch {
        // A serialization hiccup must not crash the canvas; the next
        // interaction retries.
      }
    }, debounceMs);
  };

  const flushPending = () => {
    if (!debounceTimer) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    try {
      const json = serializeScene();
      if (json !== lastBaseline) {
        lastBaseline = json;
        opts.onSceneChange?.(json);
      }
    } catch {
      // Unusable scene at unmount is dropped — the save path would have
      // aborted on it anyway.
    }
  };

  // ---- React root hosting the <Excalidraw> surface ----
  const root = ReactDOMClient.createRoot(el);
  root.render(
    React.createElement(Excalidraw, {
      initialData: initial || undefined,
      onChange: handleSceneChange,
      UIOptions: {
        canvasActions: {
          // Excalidraw's own persistence paths bypass the tab: "Open" swaps
          // content via a file picker and the Export dialog's "Save to disk"
          // downloads an unmapped .excalidraw file. The host save flow
          // (Cmd/S + the tab dirty flag) owns persistence. Image export
          // stays available.
          loadScene: false,
          export: false,
        },
      },
    }),
  );

  return {
    getSceneJson() {
      try {
        return serializeScene();
      } catch {
        return null;
      }
    },
    async exportPng() {
      const { elements, appState, files } = latest;
      return await exportToBlob({ elements, appState, files, mimeType: 'image/png' });
    },
    async exportSvg() {
      const { elements, appState, files } = latest;
      const svg = await exportToSvg({ elements, appState, files });
      return new XMLSerializer().serializeToString(svg);
    },
    destroy() {
      flushPending();
      try {
        root.unmount();
      } catch {
        /* already unmounted */
      }
    },
  };
}
