/**
 * pdfjs-loader.ts — lazy, single-flight loader for pdf.js.
 *
 * The pdf.js bundle (≈1 MB minified) is far too heavy to put in the main
 * chunk just so a PDF tab can *possibly* be opened. Mirroring the
 * mermaid-lazy / render-deps pattern: nothing loads until the first PDF tab
 * actually renders, and the module + its worker are fetched exactly once.
 */

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

export function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      // `?url` makes Vite emit the worker as a hashed asset and hand back
      // its URL — the documented way to wire GlobalWorkerOptions under Vite.
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
      return lib;
    });
  }
  return pdfjsPromise;
}
