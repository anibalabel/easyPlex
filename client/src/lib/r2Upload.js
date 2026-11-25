import api, { getErrorMessage } from './api';

export function formatBytes(bytes) {
  const num = Number(bytes || 0);
  if (!num || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = num;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function putFileWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (file.type) {
      xhr.setRequestHeader('Content-Type', file.type);
    }
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        const pct = Math.min(99, Math.max(1, Math.round((ev.loaded / ev.total) * 100)));
        onProgress(pct, 'uploading');
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const err = new Error(`R2 upload HTTP ${xhr.status}`);
        err.httpStatus = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error('Direct browser upload to R2 was blocked (CORS or network error).');
      err.isCorsOrNetwork = true;
      reject(err);
    };
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}

/**
 * Uploads a video file directly to Cloudflare R2 (as-is, without transcoding)
 * via presigned S3 PUT URL, or falls back to the panel endpoint when R2 direct
 * upload is unavailable or file <= 95 MB and R2 bucket CORS is not yet configured.
 */
export async function uploadVideoDirect({
  file,
  type = 'movie',
  title = '',
  quality = 'Original',
  movieId = null,
  episodeId = null,
  autoAttach = false,
  onProgress,
}) {
  if (!file) throw new Error('Select a video file first.');

  if (onProgress) onProgress(1, 'preparing');

  const { data: presign } = await api.post('/admin/video/r2/presign', {
    filename: file.name,
    content_type: file.type || 'video/mp4',
    file_size: file.size,
    type,
    quality,
    title,
    movie_id: movieId,
    episode_id: episodeId,
  });

  if (presign?.mode === 'presigned_r2' && presign.upload_url) {
    try {
      await putFileWithProgress(presign.upload_url, file, onProgress);
      if (onProgress) onProgress(99, 'registering');
      const { data: registered } = await api.post('/admin/video/r2/complete', {
        key: presign.key,
        public_url: presign.public_url,
        original_name: file.name,
        title: title || '',
        quality: quality || 'Original',
        file_size: file.size,
        type,
        movie_id: movieId,
        episode_id: episodeId,
        auto_attach: autoAttach,
      });
      if (onProgress) onProgress(100, 'done');
      return registered;
    } catch (directErr) {
      // Retry via Worker -> R2 S3 PUT for files <= 95 MB if bucket CORS isn't set yet
      if (directErr?.isCorsOrNetwork && presign.has_worker_fallback) {
        if (onProgress) onProgress(5, 'uploading');
        return uploadViaServerForm({
          file,
          type,
          title,
          quality,
          movieId,
          episodeId,
          autoAttach,
          onProgress,
        });
      }
      if (directErr?.isCorsOrNetwork) {
        throw new Error(
          `Direct upload to Cloudflare R2 failed (likely R2 CORS for ${window.location.origin}). Open Video Storage & R2 and click "Enable R2 CORS" or add CORS rules in Cloudflare Dashboard for files over ${presign.max_worker_mb || 95} MB.`
        );
      }
      throw new Error(getErrorMessage(directErr));
    }
  }

  return uploadViaServerForm({
    file,
    type,
    title,
    quality,
    movieId,
    episodeId,
    autoAttach,
    onProgress,
  });
}

async function uploadViaServerForm({
  file,
  type,
  title,
  quality,
  movieId,
  episodeId,
  autoAttach,
  onProgress,
}) {
  const fd = new FormData();
  fd.append('video', file);
  fd.append('type', type || 'movie');
  if (title) fd.append('title', title);
  if (quality) fd.append('quality', quality);
  if (movieId) fd.append('movie_id', String(movieId));
  if (episodeId) fd.append('episode_id', String(episodeId));
  if (autoAttach) fd.append('auto_attach', '1');

  const { data } = await api.post('/admin/videos/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (ev) => {
      if (ev.total && onProgress) {
        const pct = Math.min(98, Math.max(1, Math.round((ev.loaded / ev.total) * 100)));
        onProgress(pct, 'uploading');
      }
    },
  });
  if (onProgress) onProgress(100, 'done');
  return data;
}
