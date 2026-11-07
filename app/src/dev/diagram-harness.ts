/**
 * Dev harness for the two canvas panes — open `/diagram-harness.html` on the
 * Vite dev server (`npm --prefix app run dev`).
 *
 * It mounts the REAL adapters the panes use:
 *
 *   - `mountExcalidraw` (lib/excalidraw-runtime.ts) against a small scene, then
 *     checks the DOM actually produced a canvas, that `getSceneJson()` round
 *     trips, and that the export helpers work.
 *   - the diagrams.net embed iframe with the same URL/params DrawioPane uses,
 *     driving the JSON postMessage handshake (`init` → `load` → `autosave`).
 *
 * Results land on `window.__diagramHarness` (a promise) so a headless run can
 * read them without eyeballing the page.
 */
import { mountExcalidraw } from '../lib/excalidraw-runtime';
import { parseExcalidrawScene } from '../lib/excalidraw-scene';
import { drawioEditorUrl } from '../lib/drawio';

const statusEl = document.getElementById('status') as HTMLElement;
const exEl = document.getElementById('ex') as HTMLElement;
const dwFrame = document.getElementById('dw') as HTMLIFrameElement;
const logEl = document.getElementById('log') as HTMLElement;

function log(line: string) {
  logEl.textContent += line + '\n';
}

const SAMPLE_SCENE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'solomd-harness',
  elements: [
    {
      id: 'rect-1',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 160,
      height: 90,
      angle: 0,
      strokeColor: '#1e1e1e',
      backgroundColor: '#a5d8ff',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: { type: 3 },
      seed: 1,
      version: 1,
      versionNonce: 1,
      updated: 1,
      isDeleted: false,
      boundElements: null,
      link: null,
      locked: false,
    },
  ],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
});

const result: Record<string, unknown> = {};

async function runExcalidraw() {
  const started = performance.now();
  const changes: string[] = [];
  const handle = await mountExcalidraw(exEl, {
    scene: parseExcalidrawScene(SAMPLE_SCENE),
    debounceMs: 50,
    onSceneChange: (json) => changes.push(json),
  });
  await new Promise((r) => setTimeout(r, 4000));
  result.excalidrawChangeCountAfterMount = changes.length;
  result.excalidrawChangeEqualsInput = changes.map((c) => c === SAMPLE_SCENE);
  result.excalidrawChangedKeys = changes.slice(0, 1).map((c) => {
    try {
      const a = JSON.parse(SAMPLE_SCENE);
      const b = JSON.parse(c);
      const keys = new Set([...Object.keys(a.appState || {}), ...Object.keys(b.appState || {})]);
      return [...keys].filter(
        (k) => JSON.stringify(a.appState?.[k]) !== JSON.stringify(b.appState?.[k]),
      );
    } catch {
      return ['<parse failed>'];
    }
  });
  result.excalidrawMountMs = Math.round(performance.now() - started);
  // Give React one frame + the library's own async canvas sizing a moment.
  await new Promise((r) => setTimeout(r, 1500));
  result.excalidrawCanvasCount = exEl.querySelectorAll('canvas').length;
  result.excalidrawHostHtmlLen = exEl.innerHTML.length;
  result.excalidrawHasCss = !!Array.from(document.styleSheets).find((s) =>
    (s.href || '').includes('excalidraw'),
  );
  result.excalidrawComputedBg = getComputedStyle(exEl).backgroundColor;
  const json = handle.getSceneJson();
  result.excalidrawSceneJsonLen = json ? json.length : 0;
  try {
    const parsed = parseExcalidrawScene(json);
    result.excalidrawElementsRoundTrip = parsed?.elements.length ?? -1;
  } catch (e) {
    result.excalidrawRoundTripError = String(e);
  }
  try {
    const png = await handle.exportPng();
    result.excalidrawPngBytes = png.size;
  } catch (e) {
    result.excalidrawPngError = String(e);
  }
  try {
    const svg = await handle.exportSvg();
    result.excalidrawSvgLen = svg.length;
  } catch (e) {
    result.excalidrawSvgError = String(e);
  }
  handle.destroy();
  result.excalidrawAfterDestroyCanvasCount = exEl.querySelectorAll('canvas').length;
}

const messages: unknown[] = [];
function runDrawio() {
  return new Promise<void>((resolve) => {
    let sawAutosave = false;
    const url = drawioEditorUrl('en');
    result.drawioUrl = url;
    dwFrame.src = url;
    const timer = setTimeout(() => {
      result.drawioTimedOut = true;
      result.drawioMessages = messages;
      resolve();
    }, 25000);
    window.addEventListener('message', (ev: MessageEvent) => {
      if (ev.source !== dwFrame.contentWindow) return;
      let msg: Record<string, unknown> | null = null;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (!msg) return;
      messages.push({ event: msg.event ?? msg.action, keys: Object.keys(msg) });
      if (msg.event === 'init') {
        result.drawioInit = true;
        dwFrame.contentWindow?.postMessage(
          JSON.stringify({ action: 'load', xml: undefined, autosave: 1 }),
          '*',
        );
        setTimeout(() => {
          if (sawAutosave) return;
          // Nudge the model so drawio emits an autosave we can observe.
          dwFrame.contentWindow?.postMessage(
            JSON.stringify({ action: 'load', xml: undefined, autosave: 1 }),
            '*',
          );
        }, 1500);
      }
      if (msg.event === 'autosave' || msg.event === 'save') {
        sawAutosave = true;
        result.drawioAutosave = true;
        result.drawioAutosaveLen = typeof msg.xml === 'string' ? msg.xml.length : 0;
        result.drawioAutosaveHasMxfile =
          typeof msg.xml === 'string' && /<mxfile[\s>]/i.test(msg.xml);
        clearTimeout(timer);
        setTimeout(() => {
          result.drawioMessages = messages;
          resolve();
        }, 800);
      }
      if (msg.event === 'configure') {
        dwFrame.contentWindow?.postMessage(
          JSON.stringify({ action: 'configure', config: {} }),
          '*',
        );
      }
    });
  });
}

(async () => {
  try {
    await runExcalidraw();
  } catch (e) {
    result.excalidrawMountError = String((e as Error)?.stack || e);
  }
  statusEl.textContent = 'excalidraw done, loading drawio…';
  try {
    await runDrawio();
  } catch (e) {
    result.drawioError = String(e);
  }
  statusEl.textContent = 'done';
  result.ready = true;
  log(JSON.stringify(result, null, 2));
  (window as unknown as Record<string, unknown>).__diagramHarness = result;
})();
