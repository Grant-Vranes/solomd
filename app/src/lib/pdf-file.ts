/**
 * pdf-file.ts — shared "is this file a PDF?" helpers.
 *
 * PDF files open as a real document tab (TabBar entry + PdfPane viewer with
 * pdf.js rendering, page nav and zoom) instead of being run through the
 * markitdown converter. Importing PDF → Markdown still exists — it lives in
 * File → Import Documents (useFiles.importDocuments) — but a plain open now
 * shows the document itself, matching how images and HTML files open in-app.
 */

export function isPdfName(name: string | undefined | null): boolean {
  if (!name) return false;
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ext === 'pdf';
}
