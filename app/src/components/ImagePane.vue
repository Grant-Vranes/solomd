<script setup lang="ts">
/**
 * ImagePane.vue — full-tab image viewer (zoom / pan) for image files.
 *
 * Image files (png/jpg/webp/svg/…) open as a real document tab — they get a
 * TabBar entry like any other file — but the pane renders the image in a
 * zoomable viewer instead of the text editor (the tab's content stays empty,
 * so the tab is always "clean" and Ctrl+S can never clobber the file).
 *
 * Zoom: toolbar buttons (− / % / + / 1:1 / Fit), plain wheel = zoom at
 * cursor, Ctrl/Cmd+wheel = zoom too, Ctrl/Cmd +/-/0 keyboard shortcuts,
 * pinch on touch screens. Pan: pointer drag when zoomed past the viewport.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useTabsStore } from '../stores/tabs';
import { useI18n } from '../i18n';
import { normalizePath } from '../lib/image-resolve';

const MIN_SCALE = 0.05;
const MAX_SCALE = 32;
// Smooth wheel zoom: scale factor derived from actual deltaY, not a fixed
// step — one wheel notch (~100) ≈ ×1.1, trackpad pixel deltas scroll gently.
const WHEEL_ZOOM_RATE = 0.0022;
// Fixed step for the toolbar buttons and Ctrl/Cmd +/- keys.
const ZOOM_STEP = 1.25;

const props = defineProps<{ tabId: string }>();

const { t } = useI18n();
const tabs = useTabsStore();

const viewportEl = ref<HTMLElement | null>(null);
const imgEl = ref<HTMLImageElement | null>(null);
const loaded = ref(false);
const loadError = ref(false);
const scale = ref(1);
// Offset from viewport center, in px.
const offsetX = ref(0);
const offsetY = ref(0);
// 1 when scale is 1 AND image is shown at natural size (fit is a different
// baseline), so the "1:1" button can highlight / still be meaningful.
const naturalBase = ref(true);
const naturalW = ref(0);
const naturalH = ref(0);

const tab = () => tabs.tabs.find((x) => x.id === props.tabId);
const src = computed(() => {
  const p = tab()?.filePath;
  return p ? convertFileSrc(normalizePath(p)) : '';
});
const fileName = computed(() => tab()?.fileName ?? '');

const zoomPct = computed(() => `${Math.round(scale.value * 100)}%`);
const atNatural = computed(
  () => naturalBase.value && Math.abs(scale.value - 1) < 0.001,
);

function clamp(s: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

function applyTransform() {
  const img = imgEl.value;
  if (!img) return;
  img.style.transform = `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`;
}

function setScale(next: number, cx?: number, cy?: number) {
  const clamped = clamp(next);
  if (cx == null || cy == null) {
    // Zoom around the viewport center.
    scale.value = clamped;
  } else {
    // Keep the point under the cursor fixed.
    const rect = viewportEl.value?.getBoundingClientRect();
    if (!rect) { scale.value = clamped; }
    else {
      const px = cx - rect.left - rect.width / 2 - offsetX.value;
      const py = cy - rect.top - rect.height / 2 - offsetY.value;
      const ratio = clamped / scale.value;
      offsetX.value = px - ratio * px;
      offsetY.value = py - ratio * py;
      scale.value = clamped;
    }
  }
  applyTransform();
}

function zoomIn(cx?: number, cy?: number) {
  setScale(scale.value * ZOOM_STEP, cx, cy);
}
function zoomOut(cx?: number, cy?: number) {
  setScale(scale.value / ZOOM_STEP, cx, cy);
}

/** Fit the image inside the viewport (same logic the overlay uses). */
function fitToScreen() {
  const vp = viewportEl.value;
  const img = imgEl.value;
  if (!vp || !img || !naturalW.value) return;
  const availW = vp.clientWidth - 48;
  const availH = vp.clientHeight - 48;
  const fit = Math.min(availW / naturalW.value, availH / naturalH.value, 1);
  scale.value = fit;
  offsetX.value = 0;
  offsetY.value = 0;
  naturalBase.value = false;
  applyTransform();
}

/** Reset to 100% — image at its natural pixel size, centered. */
function resetToNatural() {
  scale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
  naturalBase.value = true;
  applyTransform();
}

/**
 * Wheel zoom — Ctrl/Cmd+wheel only. Plain wheel is left untouched so the
 * mouse stays "calm"; accidental two-finger scrolls no longer blow the
 * image up. Exponential scaling on the true deltaY keeps trackpads smooth.
 */
function onWheel(e: WheelEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const delta = Math.max(-120, Math.min(120, e.deltaY));
  setScale(scale.value * Math.exp(-delta * WHEEL_ZOOM_RATE), e.clientX, e.clientY);
}

function onKeydown(e: KeyboardEvent) {
  if (!tab() || tab()!.id !== tabs.activeId) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
  else if (mod && e.key === '-') { e.preventDefault(); zoomOut(); }
  else if (mod && e.key === '0') { e.preventDefault(); resetToNatural(); }
}

// ---- Pointer pan + pinch ----
const pointers = new Map<number, { x: number; y: number }>();
let pinchStartDist = 0;
let pinchStartScale = 1;

function pinchDistance(): number {
  const pts = Array.from(pointers.values());
  if (pts.length < 2) return 0;
  const [a, b] = pts;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function onPointerDown(e: PointerEvent) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  viewportEl.value?.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    pinchStartDist = pinchDistance();
    pinchStartScale = scale.value;
  }
}

function onPointerMove(e: PointerEvent) {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const curr = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, curr);

  if (pointers.size >= 2) {
    const dist = pinchDistance();
    if (pinchStartDist > 0 && dist > 0) {
      const pts = Array.from(pointers.values());
      setScale(
        pinchStartScale * (dist / pinchStartDist),
        (pts[0].x + pts[1].x) / 2,
        (pts[0].y + pts[1].y) / 2,
      );
    }
    return;
  }

  offsetX.value += curr.x - prev.x;
  offsetY.value += curr.y - prev.y;
  applyTransform();
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStartDist = 0;
}

function onImgLoad() {
  loaded.value = true;
  loadError.value = false;
  const img = imgEl.value;
  if (!img) return;
  naturalW.value = img.naturalWidth || img.width;
  naturalH.value = img.naturalHeight || img.height;
  // First open: fit inside the pane (never upscale beyond 1).
  fitToScreen();
}

function onImgError() {
  loadError.value = true;
  loaded.value = false;
}

// Re-fit when the pane is resized so the image never overflows oddly.
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  if (viewportEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (!naturalBase.value && pointers.size === 0) {
        // Keep the fit baseline responsive to pane size changes.
        const vp = viewportEl.value;
        if (!vp || !naturalW.value) return;
        const fit = Math.min(
          (vp.clientWidth - 48) / naturalW.value,
          (vp.clientHeight - 48) / naturalH.value,
          1,
        );
        if (Math.abs(scale.value - fit) > 0.01) {
          scale.value = fit;
          offsetX.value = 0;
          offsetY.value = 0;
          applyTransform();
        }
      }
    });
    resizeObserver.observe(viewportEl.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="imgpane">
    <div
      v-if="src"
      ref="viewportEl"
      class="imgpane__viewport"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dragstart.prevent
    >
      <img
        ref="imgEl"
        :key="src"
        :src="src"
        :alt="fileName"
        class="imgpane__img"
        draggable="false"
        @load="onImgLoad"
        @error="onImgError"
      />
      <div v-if="loaded" class="imgpane__hint">Ctrl / ⌘ + Scroll · Drag</div>
    </div>
    <div v-if="loadError" class="imgpane__error" role="status">
      {{ t('overlay.image') }} — {{ fileName }}
    </div>

    <div v-if="loaded" class="imgpane__bar">
      <button :title="t('overlay.zoomOut')" @click="zoomOut()">−</button>
      <span class="imgpane__pct">{{ zoomPct }}</span>
      <button :title="t('overlay.zoomIn')" @click="zoomIn()">+</button>
      <button :title="t('overlay.resetZoom')" :class="{ 'imgpane__active': atNatural }" @click="resetToNatural">1:1</button>
      <button :title="t('overlay.resetZoom')" @click="fitToScreen">{{ t('overlay.fit') }}</button>
    </div>
  </div>
</template>

<style scoped>
.imgpane {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    /* checkerboard so transparency is visible */
    repeating-conic-gradient(var(--bg-active, #eee) 0% 25%, transparent 0% 50%)
    0 0 / 16px 16px;
}
.imgpane__viewport {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.imgpane__viewport:active { cursor: grabbing; }
.imgpane__img {
  max-width: none;
  transform-origin: center center;
  -webkit-user-drag: none;
  user-select: none;
  will-change: transform;
}
.imgpane__error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
}
.imgpane__hint {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 10px;
  font-size: 11px;
  color: var(--text-faint);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.4s;
  pointer-events: none;
  z-index: 5;
}
.imgpane__viewport:hover .imgpane__hint { opacity: 1; }
.imgpane__bar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--sh-pop);
  z-index: 5;
}
.imgpane__bar button {
  min-width: 26px;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.imgpane__bar button:hover {
  background: var(--bg-hover);
  color: var(--accent);
}
.imgpane__pct {
  min-width: 46px;
  text-align: center;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-muted);
}
.imgpane__active {
  color: var(--accent) !important;
  font-weight: 600;
}
</style>
