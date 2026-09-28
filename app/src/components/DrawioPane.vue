<script setup lang="ts">
/**
 * DrawioPane.vue — full-tab viewer/editor for `.drawio` diagram files.
 *
 * Vue port of horseMD's DrawioEditor.jsx: an iframe to the diagrams.net embed
 * app speaking the JSON postMessage protocol ({action:'load'} out,
 * {event:'init'/'autosave'/'save'} in). Edits flow back through
 * `tabs.setContent` so the existing dirty flag and Cmd+S pipeline own
 * persistence — same contract as ExcalidrawPane.
 *
 * Baseline rule (ported verbatim): drawio re-serializes XML on load, so the
 * first observed autosave is a baseline, not an edit — init churn must never
 * mark the tab dirty.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useTabsStore } from '../stores/tabs';
import { useI18n } from '../i18n';
import { drawioEditorUrl, drawioEmbedParams, isValidDrawioXml } from '../lib/drawio';

const CHANGE_DEBOUNCE_MS = 500;
const INIT_TIMEOUT_MS = 30000;

const props = defineProps<{ tabId: string }>();

const { t, lang } = useI18n();
const tabs = useTabsStore();

const frameUrl = ref<string | null>(null);
const frameNonce = ref(0);
const corrupt = ref(false);
const loadError = ref(false);

let frame: HTMLIFrameElement | null = null;
let ready = false;
// Offline-first URL resolution: attempt the vendored bundle (asset://), then
// the online embed host. `retry()` cycles through the remaining candidates.
let urlCandidates: string[] = [];
let urlAttempt = 0;
// First observed save after mount is a baseline, not an edit.
let baseline: string | null = null;
let latestXml: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let initTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmitted: string | null = null;
let destroyed = false;

const tab = () => tabs.tabs.find((x) => x.id === props.tabId);

function postToFrame(payload: Record<string, unknown>) {
  frame?.contentWindow?.postMessage(JSON.stringify(payload), '*');
}

function scheduleChange(xml: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (xml === baseline) return;
    baseline = xml;
    emitChange(xml);
  }, CHANGE_DEBOUNCE_MS);
}

function emitChange(xml: string) {
  lastEmitted = xml;
  tabs.setContent(props.tabId, xml);
}

function onMessage(event: MessageEvent) {
  // Only accept messages from OUR iframe.
  if (event.source !== frame?.contentWindow) return;
  let msg: Record<string, unknown> | null = null;
  try {
    msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  if (msg.event === 'init') {
    ready = true;
    loadError.value = false;
    if (initTimer) {
      clearTimeout(initTimer);
      initTimer = null;
    }
    // xml omitted for a blank canvas — drawio substitutes its empty diagram.
    postToFrame({ action: 'load', xml: latestXml || undefined, autosave: 1 });
    return;
  }

  // Two distinct change events: debounced {event:'autosave'} on every model
  // edit, {event:'save'} only for explicit user saves inside the iframe.
  if (
    (msg.event === 'autosave' || msg.event === 'save') &&
    typeof msg.xml === 'string' &&
    msg.xml.length > 0
  ) {
    latestXml = msg.xml;
    if (baseline === null) {
      baseline = msg.xml;
    } else if (msg.xml !== baseline) {
      if (msg.event === 'save') {
        // Explicit save flushes the debounce immediately.
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        emitChange(msg.xml);
        baseline = msg.xml;
      } else {
        scheduleChange(msg.xml);
      }
    }
  }
}

/** Push the LIVE xml into the tab synchronously (debounce flush). */
function flushToTab() {
  if (!ready || latestXml == null || latestXml === lastEmitted) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (latestXml !== baseline) baseline = latestXml;
  emitChange(latestXml);
}

function onSaveShortcut(e: KeyboardEvent) {
  if (!ready) return;
  if (e.key !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  flushToTab();
  window.dispatchEvent(new CustomEvent('solomd:menu-action', { detail: 'file.save' }));
  e.preventDefault();
  e.stopPropagation();
}

/** Resolve iframe URL candidates: local vendored bundle first, then online. */
async function resolveUrls(): Promise<string[]> {
  const urls: string[] = [];
  try {
    const path = await invoke<string | null>('drawio_editor_path');
    if (path) {
      // asset:// URL + embed params (the asset protocol handler ignores the
      // query string). Local origin also isolates the iframe from the app.
      urls.push(`${convertFileSrc(path)}?${drawioEmbedParams(lang.value)}`);
    }
  } catch {
    // Pure-web dev server (no Tauri API) — online only.
  }
  urls.push(drawioEditorUrl(lang.value));
  return urls;
}

function mount() {
  const t0 = tab();
  if (!t0) return;
  const raw = t0.content || '';
  latestXml = isValidDrawioXml(raw) ? raw : null;
  corrupt.value = latestXml === null && !!raw.trim();
  baseline = null;
  lastEmitted = latestXml ? raw : null;
  ready = false;
  loadError.value = false;
  setFrame();
}

async function setFrame() {
  if (!urlCandidates.length) urlCandidates = await resolveUrls();
  if (destroyed) return;
  const url = urlCandidates[urlAttempt];
  if (!url) {
    loadError.value = true;
    return;
  }
  frameUrl.value = url;
  if (initTimer) clearTimeout(initTimer);
  // Frame loaded but never sent init (offline with no bundle, protocol
  // failure): surface the retry affordance.
  initTimer = setTimeout(() => {
    if (!ready && !destroyed) loadError.value = true;
  }, INIT_TIMEOUT_MS);
}

function retry() {
  // Advance to the next candidate (local → online) before giving up.
  if (urlAttempt < urlCandidates.length - 1) urlAttempt += 1;
  ready = false;
  frameNonce.value += 1;
  setFrame();
}

onMounted(() => {
  window.addEventListener('message', onMessage);
  window.addEventListener('keydown', onSaveShortcut, true);
  // saveTab() flushes CodeMirror's pending doc sync via this event; our xml
  // writes go through their own debounce, so flush here too.
  window.addEventListener('solomd:flush-content-sync', flushToTab);
  mount();
});

onBeforeUnmount(() => {
  destroyed = true;
  // Flush a pending edit so closing/switching cannot lose it.
  flushToTab();
  window.removeEventListener('message', onMessage);
  window.removeEventListener('keydown', onSaveShortcut, true);
  window.removeEventListener('solomd:flush-content-sync', flushToTab);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (initTimer) clearTimeout(initTimer);
});

// External reload (FileChangedDialog / applyDiskRead): re-mount with the
// fresh on-disk content. Our own writes are skipped via lastEmitted.
watch(
  () => tab()?.content,
  (content) => {
    if (!ready || content == null || content === lastEmitted) return;
    mount();
  },
);

function setFrameEl(el: unknown) {
  frame = (el as HTMLIFrameElement) ?? null;
}
</script>

<template>
  <div class="drawio-pane">
    <div v-if="corrupt" class="drawio-pane__corrupt">
      {{ t('drawio.corruptNote') }}
    </div>
    <div v-if="loadError" class="drawio-pane__error" role="status">
      <span>{{ t('drawio.loadError') }}</span>
      <button class="drawio-pane__retry" @click="retry">{{ t('drawio.retry') }}</button>
    </div>
    <iframe
      v-if="frameUrl"
      :key="frameNonce"
      :ref="setFrameEl"
      class="drawio-pane__frame"
      title="drawio"
      sandbox="allow-scripts allow-same-origin allow-popups allow-downloads allow-forms"
      :src="frameUrl"
    ></iframe>
  </div>
</template>

<style scoped>
.drawio-pane {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.drawio-pane__corrupt {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--warning, #b45309);
  background: var(--warning-bg, rgba(180, 83, 9, 0.08));
  border-bottom: 1px solid var(--border);
}
.drawio-pane__error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-muted, inherit);
  background: var(--warning-bg, rgba(180, 83, 9, 0.08));
  border-bottom: 1px solid var(--border);
}
.drawio-pane__retry {
  cursor: pointer;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
}
.drawio-pane__frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #fff;
}
</style>
