/**
 * image-file.ts — shared "is this file an image?" helpers.
 *
 * Image files open as a real document tab (TabBar entry + ImagePane viewer
 * with zoom/pan) instead of the fullscreen overlay. The extension set mirrors
 * the MIME table in lib/image-resolve.ts so anything the markdown preview can
 * render inline can also be opened as a tab.
 */

export const IMAGE_FILE_EXTENSIONS = new Set([
  'png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'tif', 'tiff', 'avif', 'heic', 'heif', 'ico',
]);

/** Test a file name or path by its extension. */
export function isImageFileName(name?: string | null): boolean {
  if (!name) return false;
  const ext = (name.split('.').pop() || '').toLowerCase();
  return IMAGE_FILE_EXTENSIONS.has(ext);
}
