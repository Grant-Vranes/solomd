<script setup lang="ts">
/**
 * PdfPane.vue — full-tab PDF viewer for PDF files.
 *
 * PDF files open as a real document tab — they get a TabBar entry like any
 * other file — but the pane renders the document with pdf.js instead of the
 * text editor (the tab's content stays empty, so the tab is always "clean"
 * and Ctrl+S can never clobber the file bytes).
 *
 * Rendering: pages render lazily into a vertical scroll column (an
 * IntersectionObserver draws the pages at/near the viewport and frees the
 * ones far away, so a 300-page PDF never holds 300 canvases). Controls:
 * prev/next page + "n / total" indicator, zoom − / % / + and fit-width;
 * Ctrl/Cmd+wheel zooms, plain wheel scrolls.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from '../lib/pdfjs-loader';
import { useTabsStore } from '../stores/tabs';
import { useI18n } from '../i18n';
import { normalizePath } from '../lib/image-resolve';

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
// Pages within this many of the viewport (in either direction) stay rendered.
const RENDER_MARGIN_PX = 1200;
// Pages further than this from the viewport get their canvas freed.
const UNRENDER_MARGIN_PX = 3000;

const props = defineProps<{ tabId: string }>();

const { t } = useI18n();
const tabs = useTabsStore();

const scrollEl = ref<HTMLElement | null>(null);
const loading = ref(true);
const loadError = ref(false);
const pageCount = ref(0);
const currentPage = ref(1);
const scale = ref(1);
// True while following the pane width (refit on resize); any manual zoom
// turns it off, same idea as ImagePane's fit baseline.
const fitMode = ref(true);

interface PageState {
  // Placeholder box keeps the scroll layout stable before/after render.
  width: number;
  height: number;
  canvas: HTMLCanvasElement | null;
  rendered: boolean;
  rendering: Promise<void> | null;
  // Scale the canvas was drawn at — stale pages get redrawn on zoom.
  renderedScale: number;
}

const pages = reactive<PageState[]>([]);

let doc: PDFDocumentProxy | null = null;
let loadingTask: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
let resizeObserver: ResizeObserver | null = null;
let renderSeq = 0; // invalidates in-flight renders on reload/unmount

const tab = () => tabs.tabs.find((x) => x.id === props.tabId);
const src = computed(() => {
  const p = tab()?.filePath;
  return p ? convertFileSrc(normalizePath(p)) : '';
});
const fileName = computed(() => tab()?.fileName ?? '');
const zoomPct = computed(() => `${Math.round(scale.value * 100)}%`);

function devicePixel() {
  return Math.min(window.devicePixelRatio || 1, 3);
}

function fitWidthScale() {
  const vp = scrollEl.value;
  if (!vp) return scale.value;
  // Widest page drives the fit; pages may differ (mixed sizes).
  const widest = pages.reduce((m, p) => Math.max(m, p.width), 0) || 612;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, (vp.clientWidth - 32) / widest));
}

async function renderPage(idx: number, targetScale: number) {
  const d = doc;
  if (!d) return;
  const state = pages[idx];
  if (!state) return;
  const seq = renderSeq;
  const page = await d.getPage(idx + 1);
  if (seq !== renderSeq) return; // reload happened while awaiting
  const dpr = devicePixel();
  const viewport = page.getViewport({ scale: targetScale });
  // Paint at device pixels for crisp text, lay out at CSS pixels.
  const canvas = state.canvas ?? document.createElement('canvas');
  state.canvas = canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
  if (seq !== renderSeq) return;
  state.rendered = true;
  state.renderedScale = targetScale;
  // Mount the canvas into its placeholder slot (the reactive `pages` array
  // can't hold DOM nodes across Vue patches reliably, so we append manually).
  const host = scrollEl.value?.querySelector<HTMLElement>(`[data-page-idx="${idx}"]`);
  if (host && canvas.parentElement !== host) host.appendChild(canvas);
}

async function renderPageGuarded(idx: number, targetScale: number) {
  const state = pages[idx];
  if (!state) return;
  if (state.rendered && Math.abs(state.renderedScale - targetScale) < 0.001) return;
  if (state.rendering) {
    await state.rendering;
    if (Math.abs(state.renderedScale - targetScale) < 0.001) return;
  }
  const p = renderPage(idx, targetScale).finally(() => {
    if (state.rendering === p) state.rendering = null;
  });
  state.rendering = p;
  await p;
}

function unrenderPage(idx: number) {
  const state = pages[idx];
  if (!state) return;
  if (state.rendering) return; // let it finish; it's cheap to keep
  state.rendered = false;
  state.canvas?.remove();
  state.canvas = null;
}

/** Which pages are at/near the viewport, from scroll geometry. */
function updateVisiblePages() {
  const vp = scrollEl.value;
  if (!vp) return;
  const top = vp.scrollTop;
  const bottom = top + vp.clientHeight;
  let acc = 12; // top padding
  for (let i = 0; i < pages.length; i++) {
    const h = pages[i].height * scale.value + 8;
    const pageTop = acc;
    const pageBottom = acc + h;
    acc = pageBottom;
    if (pageBottom < top - UNRENDER_MARGIN_PX) {
      unrenderPage(i);
    } else if (pageTop > bottom + UNRENDER_MARGIN_PX) {
      unrenderPage(i);
    } else if (pageBottom >= top - RENDER_MARGIN_PX && pageTop <= bottom + RENDER_MARGIN_PX) {
      void renderPageGuarded(i, scale.value);
    }
    // Track the page at the viewport center for the indicator.
    if (pageTop <= (top + bottom) / 2 && pageBottom >= (top + bottom) / 2) {
      currentPage.value = i + 1;
    }
  }
}

function scheduleVisibleUpdate() {
  window.requestAnimationFrame(updateVisiblePages);
}

function setScale(next: number) {
  scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
  fitMode.value = false;
  // The placeholder boxes bind width/height × scale in the template, so they
  // resize themselves; just redraw whatever is now visible.
  scheduleVisibleUpdate();
}

function zoomIn() {
  setScale(scale.value * ZOOM_STEP);
}

function zoomOut() {
  setScale(scale.value / ZOOM_STEP);
}

function fitWidth() {
  fitMode.value = true;
  scale.value = fitWidthScale();
  scheduleVisibleUpdate();
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0022);
  setScale(scale.value * factor);
}

function gotoPage(n: number) {
  const vp = scrollEl.value;
  const idx = Math.max(0, Math.min(pages.length - 1, n - 1));
  if (!vp) return;
  let top = 12;
  for (let i = 0; i < idx; i++) top += pages[i].height * scale.value + 8;
  vp.scrollTo({ top: top - 8, behavior: 'smooth' });
  scheduleVisibleUpdate();
}

async function load() {
  loading.value = true;
  loadError.value = false;
  const seq = ++renderSeq;
  pages.length = 0;
  try {
    // Lazy: pdf.js (~1 MB) is only fetched when the first PDF tab renders.
    const pdfjsLib = await loadPdfjs();
    if (seq !== renderSeq) return;
    const task = pdfjsLib.getDocument({ url: src.value });
    const d = await task.promise;
    if (seq !== renderSeq) {
      void task.destroy();
      return;
    }
    loadingTask = task;
    doc = d;
    pageCount.value = d.numPages;
    for (let i = 1; i <= d.numPages; i++) {
      const page = await d.getPage(i);
      if (seq !== renderSeq) return;
      const vp1 = page.getViewport({ scale: 1 });
      pages.push({
        width: vp1.width,
        height: vp1.height,
        canvas: null,
        rendered: false,
        rendering: null,
        renderedScale: 0,
      });
    }
    loading.value = false;
    fitWidth();
  } catch (e) {
    if (seq !== renderSeq) return;
    console.error('pdf load failed', e);
    loading.value = false;
    loadError.value = true;
  }
}

function destroyDoc() {
  renderSeq++;
  for (const p of pages) {
    p.canvas?.remove();
    p.canvas = null;
    p.rendering = null;
  }
  pages.length = 0;
  doc = null;
  void loadingTask?.destroy();
  loadingTask = null;
}

onMounted(() => {
  void load();
  window.addEventListener('solomd:tab-disk-reloaded', onDiskReloaded);
  if (scrollEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (fitMode.value && pages.length) {
        scale.value = fitWidthScale();
      }
      scheduleVisibleUpdate();
    });
    resizeObserver.observe(scrollEl.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('solomd:tab-disk-reloaded', onDiskReloaded);
  destroyDoc();
  resizeObserver?.disconnect();
});

/** External change → the watcher reloaded this tab's file: re-fetch bytes. */
function onDiskReloaded(e: Event) {
  const { tabId } = (e as CustomEvent).detail || {};
  if (tabId !== props.tabId) return;
  void load();
}

defineExpose({ reload: load });
</script>

<template>
  <div class="pdfpane">
    <div v-if="loading" class="pdfpane__status" role="status">{{ t('pdfViewer.loading') }}</div>
    <div v-else-if="loadError" class="pdfpane__status pdfpane__error" role="status">
      {{ t('pdfViewer.loadFailed') }} — {{ fileName }}
    </div>
    <div
      v-else
      ref="scrollEl"
      class="pdfpane__scroll"
      @wheel="onWheel"
      @scroll="scheduleVisibleUpdate"
    >
      <div
        v-for="(p, i) in pages"
        :key="i"
        class="pdfpane__page"
        :data-page-idx="i"
        :style="{
          width: `${Math.floor(p.width * scale)}px`,
          height: `${Math.floor(p.height * scale)}px`,
        }"
      />
      <div class="pdfpane__endpad" />
    </div>

    <div v-if="!loading && !loadError" class="pdfpane__bar">
      <button :title="t('pdfViewer.prevPage')" :disabled="currentPage <= 1" @click="gotoPage(currentPage - 1)">‹</button>
      <span class="pdfpane__pct">{{ currentPage }} / {{ pageCount }}</span>
      <button :title="t('pdfViewer.nextPage')" :disabled="currentPage >= pageCount" @click="gotoPage(currentPage + 1)">›</button>
      <span class="pdfpane__sep" />
      <button :title="t('pdfViewer.zoomOut')" @click="zoomOut()">−</button>
      <span class="pdfpane__pct">{{ zoomPct }}</span>
      <button :title="t('pdfViewer.zoomIn')" @click="zoomIn()">+</button>
      <button :title="t('pdfViewer.fitWidth')" :class="{ 'pdfpane__active': fitMode }" @click="fitWidth">{{ t('pdfViewer.fit') }}</button>
    </div>
  </div>
</template>

<style scoped>
.pdfpane {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-active, #f0f0f0);
}
.pdfpane__scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.pdfpane__page {
  flex: 0 0 auto;
  background: #fff;
  border: 1px solid var(--border, #ddd);
  box-shadow: var(--sh-pop, 0 1px 4px rgba(0, 0, 0, 0.12));
  overflow: hidden;
}
.pdfpane__page canvas {
  display: block;
}
.pdfpane__endpad {
  flex: 0 0 60px;
}
.pdfpane__status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
}
.pdfpane__error {
  color: var(--text);
}
.pdfpane__bar {
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
.pdfpane__bar button {
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
.pdfpane__bar button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent);
}
.pdfpane__bar button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.pdfpane__pct {
  min-width: 52px;
  text-align: center;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-muted);
}
.pdfpane__sep {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border);
}
.pdfpane__active {
  color: var(--accent) !important;
  font-weight: 600;
}
</style>
