<script setup lang="ts">
/**
 * ExcalidrawPane.vue — full-tab editor for `.excalidraw` scene files.
 *
 * Vue wrapper around `mountExcalidraw` (see excalidraw-runtime.ts for the
 * React containment + baseline/debounce contract, ported from horseMD's
 * ExcalidrawEditor.jsx). The scene is parsed exactly once per tab mount;
 * edits flow back through `tabs.setContent` so the existing dirty flag and
 * Cmd+S save pipeline own persistence — no separate save path here.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useTabsStore } from '../stores/tabs';
import {
  parseExcalidrawScene,
} from '../lib/excalidraw-scene';
import { mountExcalidraw, type ExcalidrawHandle } from '../lib/excalidraw-runtime';
import { useI18n } from '../i18n';

const props = defineProps<{ tabId: string }>();

const { t } = useI18n();
const tabs = useTabsStore();

const host = ref<HTMLElement | null>(null);
const corrupt = ref(false);
let handle: ExcalidrawHandle | null = null;
// Last JSON this pane published (or loaded). External tab.content updates
// that differ from it are disk reloads and re-mount the board.
let lastEmitted: string | null = null;
let mounting = false;

const tab = () => tabs.tabs.find((x) => x.id === props.tabId);

async function mount() {
  if (!host.value) return;
  const t0 = tab();
  if (!t0) return;
  handle?.destroy();
  handle = null;
  const text = t0.content || '';
  const scene = parseExcalidrawScene(text);
  corrupt.value = scene === null && !!text.trim();
  lastEmitted = scene ? text : null;
  mounting = true;
  try {
    handle = await mountExcalidraw(host.value, {
      scene,
      onSceneChange: (json) => {
        lastEmitted = json;
        tabs.setContent(props.tabId, json);
      },
    });
  } catch {
    // Chunk load failure (offline install, etc.) — leave the empty host.
  } finally {
    mounting = false;
  }
}

onMounted(() => {
  mount();
  // Save-shortcut bridge: excalidraw's own keyboard handling stops keydown
  // propagation inside its container, so the app-level window keydown listener
  // (useShortcuts, bubble phase) never sees Cmd/Ctrl+S on a whiteboard tab.
  // Capture on window BEFORE excalidraw's handlers and route to the same
  // menu-action path the menubar uses.
  window.addEventListener('keydown', onSaveShortcut, true);
  // saveTab() flushes CodeMirror's pending doc sync via this event; our scene
  // writes go through their own 500ms debounce, so flush here too — otherwise
  // a save issued right after a stroke would read stale tab.content.
  window.addEventListener('solomd:flush-content-sync', flushToTab);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onSaveShortcut, true);
  window.removeEventListener('solomd:flush-content-sync', flushToTab);
  handle?.destroy();
  handle = null;
});

/** Push the LIVE scene into the tab synchronously (debounce flush). */
function flushToTab() {
  if (!handle) return;
  const json = handle.getSceneJson();
  if (json == null || json === lastEmitted) return;
  lastEmitted = json;
  tabs.setContent(props.tabId, json);
}

function onSaveShortcut(e: KeyboardEvent) {
  if (e.key !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  flushToTab();
  window.dispatchEvent(new CustomEvent('solomd:menu-action', { detail: 'file.save' }));
  e.preventDefault();
  e.stopPropagation();
}

// External reload (FileChangedDialog / applyDiskRead): re-mount with the
// fresh on-disk scene. Our own writes are skipped via lastEmitted.
watch(
  () => tab()?.content,
  (content) => {
    if (mounting || !handle) return;
    if (content == null || content === lastEmitted) return;
    mount();
  },
);
</script>

<template>
  <div class="excalidraw-pane">
    <div v-if="corrupt" class="excalidraw-pane__corrupt">
      {{ t('excalidraw.corruptNote') }}
    </div>
    <div ref="host" class="excalidraw-pane__host"></div>
  </div>
</template>

<style scoped>
.excalidraw-pane {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.excalidraw-pane__corrupt {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--warning, #b45309);
  background: var(--warning-bg, rgba(180, 83, 9, 0.08));
  border-bottom: 1px solid var(--border);
}
/* Excalidraw's component fills its nearest sized container. */
.excalidraw-pane__host {
  flex: 1;
  min-height: 0;
}
</style>
