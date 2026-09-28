<script lang="ts">
export interface ExcalidrawOpenDetail {
  /** Zero-based index of the ```excalidraw fence in the owning tab. */
  fenceIndex: number;
  /** Owning tab id (writeback target). */
  tabId: string;
  /** Initial scene JSON string (the fence body at click time). */
  sceneJson: string;
}

export const EXCALIDRAW_OPEN_EVENT = 'solomd:excalidraw-open';
</script>

<script setup lang="ts">
/**
 * ExcalidrawOverlay — fullscreen ```excalidraw fence editor.
 *
 * Opened by the `solomd:excalidraw-open` window event (dispatched from a
 * preview thumbnail click). Mounts the dynamic-import excalidraw runtime and
 * writes edits straight back into the owning tab's Markdown via
 * `replaceExcalidrawFence` — the same fence-splice model WhiteboardOverlay
 * uses for tldraw, so preview thumbnails, git history and disk stay in sync.
 * Esc closes.
 */
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useI18n } from '../i18n';
import { useTabsStore } from '../stores/tabs';
import { replaceExcalidrawFence } from '../lib/excalidraw-scene';
import type { ExcalidrawHandle } from '../lib/excalidraw-runtime';

const { t } = useI18n();
const tabs = useTabsStore();

const open = ref(false);
const loading = ref(false);
const surface = ref<HTMLDivElement | null>(null);
let handle: ExcalidrawHandle | null = null;
let current: ExcalidrawOpenDetail | null = null;
// Bumped on every open/close so a slow async mount that resolves after the
// overlay was re-opened (or closed) tears itself down instead of leaking a
// second React root onto the surface.
let mountToken = 0;

async function onOpen(e: Event) {
  const detail = (e as CustomEvent<ExcalidrawOpenDetail>).detail;
  if (!detail) return;
  // Re-opening while a board is live: tear the old one down first.
  if (handle) {
    try {
      handle.destroy();
    } catch {
      /* already gone */
    }
    handle = null;
  }
  current = detail;
  open.value = true;
  loading.value = true;
  const token = ++mountToken;
  // Wait a tick so the surface div renders, then mount the editor.
  await Promise.resolve();
  requestAnimationFrame(async () => {
    if (token !== mountToken || !surface.value || !current) return;
    try {
      const { mountExcalidraw } = await import('../lib/excalidraw-runtime');
      const { parseExcalidrawScene } = await import('../lib/excalidraw-scene');
      const mounted = await mountExcalidraw(surface.value, {
        scene: parseExcalidrawScene(current.sceneJson),
        onSceneChange: (sceneJson) => {
          if (!current) return;
          const tab = tabs.tabs.find((x) => x.id === current!.tabId);
          if (!tab) return;
          const next = replaceExcalidrawFence(tab.content || '', current.fenceIndex, sceneJson);
          if (next !== tab.content) tabs.setContent(current.tabId, next);
        },
      });
      // The overlay was closed / re-opened while excalidraw was loading — discard.
      if (token !== mountToken) {
        try {
          mounted.destroy();
        } catch {
          /* no-op */
        }
        return;
      }
      handle = mounted;
    } catch {
      /* mount failed (corrupt scene / chunk load) — leave the empty surface */
    } finally {
      if (token === mountToken) loading.value = false;
    }
  });
}

function close() {
  mountToken++;
  open.value = false;
  loading.value = false;
  current = null;
  try {
    handle?.destroy();
  } catch {
    /* already gone */
  }
  handle = null;
}

function onKeydown(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

onMounted(() => {
  window.addEventListener(EXCALIDRAW_OPEN_EVENT, onOpen);
  window.addEventListener('keydown', onKeydown);
  // Save-shortcut bridge (same reason as ExcalidrawPane): excalidraw stops
  // keydown propagation inside its container, so route Cmd/Ctrl+S through the
  // menu-action path and flush the pending debounced scene write first.
  window.addEventListener('keydown', onSaveShortcut, true);
  window.addEventListener('solomd:flush-content-sync', flushToTab);
});

onBeforeUnmount(() => {
  window.removeEventListener(EXCALIDRAW_OPEN_EVENT, onOpen);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('keydown', onSaveShortcut, true);
  window.removeEventListener('solomd:flush-content-sync', flushToTab);
  close();
});

/** Push the LIVE scene into the owning tab's fence synchronously. */
function flushToTab() {
  if (!handle || !current) return;
  const json = handle.getSceneJson();
  if (json == null) return;
  const tab = tabs.tabs.find((x) => x.id === current!.tabId);
  if (!tab) return;
  const next = replaceExcalidrawFence(tab.content || '', current.fenceIndex, json);
  if (next !== tab.content) tabs.setContent(current.tabId, next);
}

function onSaveShortcut(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  flushToTab();
  window.dispatchEvent(new CustomEvent('solomd:menu-action', { detail: 'file.save' }));
  e.preventDefault();
  e.stopPropagation();
}
</script>

<template>
  <div v-if="open" class="ex-overlay">
    <div class="ex-overlay__bar">
      <span class="ex-overlay__title">{{ t('excalidraw.fenceTitle') }}</span>
      <button class="ex-overlay__close" @click="close" :title="t('whiteboard.closeFull')">
        {{ t('whiteboard.closeFull') }}
      </button>
    </div>
    <div ref="surface" class="ex-overlay__surface">
      <div v-if="loading" class="ex-overlay__loading">
        <span class="ex-overlay__spinner" aria-hidden="true"></span>
        <span>{{ t('whiteboard.loading') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ex-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}
.ex-overlay__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-soft, var(--bg));
}
.ex-overlay__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.ex-overlay__close {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.ex-overlay__close:hover {
  background: var(--bg-hover, var(--bg-soft));
}
.ex-overlay__surface {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.ex-overlay__loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-faint);
  font-size: 13px;
  font-style: italic;
  pointer-events: none;
}
.ex-overlay__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent, var(--text-faint));
  border-radius: 50%;
  animation: ex-overlay-spin 0.7s linear infinite;
}
@keyframes ex-overlay-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
