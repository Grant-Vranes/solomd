/**
 * drawio.ts — helpers for `.drawio` diagram files (rendered as an embedded
 * diagrams.net canvas tab, mirroring horseMD's DrawioEditor contract).
 *
 * .drawio content is XML: an `<mxfile>` wrapping one or more `<diagram>`
 * pages, optionally deflate+base64 compressed. We never parse the XML
 * semantics — it passes through to the editor iframe verbatim. This module
 * only decides "blank canvas vs corrupt file" and provides the empty template.
 */

export const EMPTY_DRAWIO_XML =
  '<mxfile host="solomd" version="31.4.5">' +
  '<diagram id="page-1" name="Page-1">' +
  '<mxGraphModel dx="1422" dy="798" grid="1" gridSize="10" guides="1" ' +
  'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" ' +
  'pageWidth="850" pageHeight="1100" math="0" shadow="0"><root>' +
  '<mxCell id="0" /><mxCell id="1" parent="0" /></root>' +
  '</mxGraphModel></diagram></mxfile>';

/** True when a tab/file name refers to a drawio diagram file. */
export function isDrawioName(name: string | undefined | null): boolean {
  return /\.drawio$/i.test(name || '');
}

/**
 * A loaded file is treated as drawio XML when it carries one of the known
 * root markers. Fully-compressed bodies (deflate+base64, no '<' at all) are
 * rejected on purpose: the corrupt fallback (blank canvas + one-shot note) is
 * the safer default for anything we cannot recognize.
 */
export function isValidDrawioXml(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  return /<mxfile[\s>]/i.test(text) || /<mxGraphModel[\s>]/i.test(text);
}

/** Embed protocol query params shared by the local and online iframe URLs. */
export function drawioEmbedParams(lang: string): string {
  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    // ui=kennedy matches the default app.diagrams.net experience (full
    // menu bar, toolbar, shape libraries, format panel inside the iframe) —
    // same choice as horseMD. Persistence is still owned by SoloMD via the
    // embed autosave protocol, so the in-frame File menu is harmless.
    ui: 'kennedy',
    noExitBtn: '1',
    spin: '1',
    lang: lang === 'zh' ? 'zh' : 'en',
  });
  return params.toString();
}

/** Online editor iframe URL (fallback when the offline bundle is absent). */
export function drawioEditorUrl(lang: string): string {
  return `https://embed.diagrams.net/?${drawioEmbedParams(lang)}`;
}
