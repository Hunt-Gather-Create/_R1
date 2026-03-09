/**
 * Extract file extension from a URL.
 */
export function getExtensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop();
    if (ext && ext.length <= 5 && ext !== pathname) {
      return ext.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sanitize a filename for safe download.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s._-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
