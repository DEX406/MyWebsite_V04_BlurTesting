import JSZip from 'jszip';

const CONTENT_TYPE_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  webm: 'video/webm',
};

function guessContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
}

// Creates a ZIP containing board.json + all R2 images at their original key paths.
// The key path is preserved (e.g. canvas/1234-photo.jpg) so restore can re-upload
// to the exact same R2 key, keeping all image URLs intact.
const CONCURRENT_DOWNLOADS = 8;

// fetchImageFn(key) => Blob, called via the server proxy to avoid R2 CORS issues
export async function createBackupZip(board, imageManifest, fetchImageFn, onProgress) {
  const zip = new JSZip();
  zip.file('board.json', JSON.stringify(board, null, 2));

  const imageFolder = zip.folder('images');
  let done = 0;
  let failed = 0;

  // Process in batches of CONCURRENT_DOWNLOADS instead of one at a time
  for (let i = 0; i < imageManifest.length; i += CONCURRENT_DOWNLOADS) {
    const batch = imageManifest.slice(i, i + CONCURRENT_DOWNLOADS);
    await Promise.all(batch.map(async (img) => {
      try {
        const blob = await fetchImageFn(img.key);
        imageFolder.file(img.key, blob);
        done++;
      } catch (err) {
        console.warn(`Skipping image ${img.key}:`, err.message);
        failed++;
      }
      onProgress?.(done + failed, imageManifest.length);
    }));
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 3 },
  });

  return { zipBlob, downloaded: done, failed };
}

// Restores a backup ZIP: re-uploads images to R2 with their original keys (preserving
// all URLs), then returns the parsed board data for the caller to apply to state.
export async function restoreFromZip(zipFile, restoreImageKeyFn, onProgress) {
  const zip = await JSZip.loadAsync(zipFile);

  const boardFile = zip.file('board.json');
  if (!boardFile) throw new Error('No board.json found in backup ZIP');
  const board = JSON.parse(await boardFile.async('text'));
  if (!Array.isArray(board.items)) throw new Error('Invalid board.json: items must be an array');

  // Collect image files stored under images/
  const imageFiles = [];
  zip.folder('images').forEach((relativePath, file) => {
    if (!file.dir) imageFiles.push({ relativePath, file });
  });

  let restored = 0;
  let failed = 0;
  for (const { relativePath, file } of imageFiles) {
    // relativePath is relative to images/, e.g. "canvas/1234567890-photo.jpg"
    const key = relativePath;
    const contentType = guessContentType(key);
    try {
      const blob = await file.async('blob');
      const { uploadUrl } = await restoreImageKeyFn(key, contentType);
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: blob,
      });
      if (!uploadRes.ok) throw new Error(`Upload returned ${uploadRes.status}`);
      restored++;
    } catch (err) {
      console.warn(`Failed to restore image ${key}:`, err.message);
      failed++;
    }
    onProgress?.(restored + failed, imageFiles.length);
  }

  return { board, restored, failed, total: imageFiles.length };
}
