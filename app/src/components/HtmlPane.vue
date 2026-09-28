<script setup lang="ts">
// HtmlPane — rendered view of an HTML document, modeled on horseMD's
// HtmlEditor. The current tab content is injected via `srcdoc` into a
// sandboxed iframe: sandbox WITHOUT allow-same-origin keeps the frame in an
// opaque origin, so its scripts cannot reach window.__TAURI__, localStorage,
// or the parent window. Using srcdoc (rather than loading the file from disk)
// means the render always reflects the live tab content — unsaved edits show
// up on the next toggle without a forced save.
// A <base href> pointed at the document's folder (via the asset protocol)
// lets relative subresources — ./style.css, images, sub-pages — load like
// they would in a browser.
import { computed } from 'vue';
import { buildHtmlBaseHref } from '../lib/html-doc';

const props = defineProps<{
  content: string;
  filePath?: string;
  /** Bump to force a full iframe reload (e.g. after external file change). */
  renderNonce?: number;
}>();

const baseHref = computed(() => buildHtmlBaseHref(props.filePath));

const doc = computed(() => {
  if (!baseHref.value) return props.content;
  const baseTag = `<base href="${baseHref.value}">`;
  if (/<head[^>]*>/i.test(props.content)) {
    return props.content.replace(/<head[^>]*>/i, (m) => m + baseTag);
  }
  if (/<html[^>]*>/i.test(props.content)) {
    return props.content.replace(/<html[^>]*>/i, (m) => m + baseTag);
  }
  // Fragment without <html>/<head>: prepend so the base still applies.
  return baseTag + props.content;
});
</script>

<template>
  <iframe
    :key="renderNonce ?? 0"
    class="html-preview-frame"
    :srcdoc="doc"
    sandbox="allow-scripts allow-popups allow-forms"
    :title="filePath || 'HTML'"
    referrerPolicy="no-referrer"
  />
</template>

<style scoped>
.html-preview-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
  display: block;
}
</style>
