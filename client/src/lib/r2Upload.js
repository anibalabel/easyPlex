import api, { getErrorMessage, getStoredToken } from './api';

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

function makeCancelError() {
  const err = new Error('Upload cancelled.');
  err.isCancelled = true;
  return err;
}

function putBlobWithProgress(
  url,
  blob,
  { contentType = '', withCredentials = false, authToken = '', parseJson = false, signal, onProgress } = {}
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeCancelError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.withCredentials = withCredentials;
    if (authToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    }
    if (contentType) {
      xhr.setRequestHeader('Content-Type', contentType);
    }

    const onAbortSignal = () => {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
      reject(makeCancelError());
    };
    if (signal) {
      signal.addEventListener('abort', onAbortSignal, { once: true });
    }

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbortSignal);
      }
    };

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(ev.loaded, ev.total);
      }
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        let json = null;
        if (parseJson && xhr.responseText) {
          try {
            json = JSON.parse(xhr.responseText);
          } catch {
            json = null;
          }
        }
        resolve({
          etag: json?.etag || xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag') || '',
          json,
        });
      } else {
        let msg = `R2 upload HTTP ${xhr.status}`;
        try {
          const parsed = JSON.parse(xhr.responseText || '{}');
          if (parsed?.message) msg = parsed.message;
        } catch {
          // ignore
        }
        const err = new Error(msg);
        err.httpStatus = xhr.status;
        reject(err);
      }
    };

    xhr.onerror = () => {
      cleanup();
      const err = new Error('Direct browser upload to R2 was blocked (CORS or network error).');
      err.isCorsOrNetwork = true;
      reject(err);
    };

    xhr.onabort = () => {
      cleanup();
      reject(makeCancelError());
    };

    xhr.send(blob);
  });
}

async function uploadMultipartParts({
  file,
  presign,
  useWorkerProxy = false,
  signal,
  onProgress,
}) {
  const partSize = Number(presign.part_size || (useWorkerProxy ? 16 : 32) * 1024 * 1024);
  const totalParts = Number(presign.total_parts || Math.ceil(file.size / partSize));
  const partUrls = { ...(presign.part_urls || {}) };
  const loadedByPart = new Map();
  const completedParts = new Array(totalParts);
  const authToken = useWorkerProxy ? getStoredToken() : '';

  const reportAggregate = () => {
    if (!onProgress) return;
    let totalLoaded = 0;
    for (const v of loadedByPart.values()) totalLoaded += v;
    const clamped = Math.min(file.size, totalLoaded);
    const pct = Math.min(98, Math.max(1, Math.round((clamped / Math.max(1, file.size)) * 100)));
    onProgress(pct, 'uploading', { loaded: clamped, total: file.size, totalParts });
  };

  const getDirectPartUrl = async (partNumber) => {
    if (partUrls[partNumber]) return partUrls[partNumber];
    const batch = [];
    for (let p = partNumber; p <= Math.min(totalParts, partNumber + 99); p += 1) {
      if (!partUrls[p]) batch.push(p);
    }
    const { data } = await api.post('/admin/video/r2/multipart/sign-part', {
      key: presign.key,
      upload_id: presign.upload_id,
      part_numbers: batch,
    });
    Object.assign(partUrls, data?.part_urls || {});
    return partUrls[partNumber];
  };

  const uploadSinglePart = async (partNumber) => {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(file.size, start + partSize);
    const chunk = file.slice(start, end);

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) throw makeCancelError();
      try {
        const res = useWorkerProxy
          ? await putBlobWithProgress(
              `/admin/video/r2/multipart/upload-part?key=${encodeURIComponent(presign.key)}&uploadId=${encodeURIComponent(
                presign.upload_id
              )}&partNumber=${partNumber}`,
              chunk,
              {
                contentType: 'application/octet-stream',
                withCredentials: true,
                authToken,
                parseJson: true,
                signal,
                onProgress: (loaded) => {
                  loadedByPart.set(partNumber, loaded);
                  reportAggregate();
                },
              }
            )
          : await putBlobWithProgress(await getDirectPartUrl(partNumber), chunk, {
              signal,
              onProgress: (loaded) => {
                loadedByPart.set(partNumber, loaded);
                reportAggregate();
              },
            });

        if (!res.etag) {
          const err = new Error(
            `R2 did not expose the ETag header on multipart chunk #${partNumber}.`
          );
          err.missingEtag = true;
          throw err;
        }
        loadedByPart.set(partNumber, chunk.size);
        reportAggregate();
        completedParts[partNumber - 1] = { partNumber, etag: res.etag };
        lastErr = null;
        return;
      } catch (err) {
        lastErr = err;
        if (err?.isCancelled || err?.missingEtag) throw err;
        if (attempt === 1 && err?.isCorsOrNetwork && !useWorkerProxy) {
          // Immediately bubble Part 1 CORS failure so caller can auto-enable CORS or switch to worker proxy
          throw err;
        }
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }
    if (lastErr) throw lastErr;
  };

  // Probe Part 1 first when using direct R2 so CORS errors are caught before launching parallel parts
  let startFromPart = 1;
  if (!useWorkerProxy) {
    await uploadSinglePart(1);
    startFromPart = 2;
  }

  let cursor = startFromPart;
  const concurrency = Math.min(useWorkerProxy ? 2 : 3, Math.max(0, totalParts - startFromPart + 1));

  if (concurrency > 0) {
    const worker = async () => {
      while (true) {
        if (signal?.aborted) throw makeCancelError();
        const partNumber = cursor;
        cursor += 1;
        if (partNumber > totalParts) return;
        await uploadSinglePart(partNumber);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  return completedParts;
}

/**
 * Uploads a video file directly to Cloudflare R2 (as-is, without transcoding).
 * - Files > 50 MB use R2 S3 Multipart (auto-configures CORS if needed, and falls back
 *   transparently to same-origin streaming Worker chunks if bucket CORS cannot be modified).
 * - Files <= 50 MB use single presigned R2 PUT (or server upload fallback if CORS is blocked).
 */
export async function uploadVideoDirect({
  file,
  type = 'movie',
  title = '',
  quality = 'Original',
  movieId = null,
  episodeId = null,
  autoAttach = false,
  signal,
  onProgress,
}) {
  if (!file) throw new Error('Select a video file first.');

  if (onProgress) onProgress(1, 'preparing', { loaded: 0, total: file.size });

  const requestPresign = async (proxyMode = false) => {
    const { data } = await api.post('/admin/video/r2/presign', {
      filename: file.name,
      content_type: file.type || 'video/mp4',
      file_size: file.size,
      type,
      quality,
      title,
      movie_id: movieId,
      episode_id: episodeId,
      proxy_mode: proxyMode,
    });
    return data;
  };

  let presign = await requestPresign(false);

  if (presign?.mode === 'multipart_r2' && presign.upload_id) {
    const completeMultipart = async (activePresign, parts) => {
      if (onProgress) onProgress(99, 'registering', { loaded: file.size, total: file.size });
      const { data: registered } = await api.post('/admin/video/r2/complete', {
        key: activePresign.key,
        upload_id: activePresign.upload_id,
        parts,
        public_url: activePresign.public_url,
        original_name: file.name,
        title: title || '',
        quality: quality || 'Original',
        file_size: file.size,
        type,
        movie_id: movieId,
        episode_id: episodeId,
        auto_attach: autoAttach,
      });
      if (onProgress) onProgress(100, 'done', { loaded: file.size, total: file.size });
      return registered;
    };

    try {
      const parts = await uploadMultipartParts({ file, presign, useWorkerProxy: false, signal, onProgress });
      return await completeMultipart(presign, parts);
    } catch (directErr) {
      if (directErr?.isCancelled) {
        api.post('/admin/video/r2/abort', { key: presign.key, upload_id: presign.upload_id }).catch(() => {});
        throw directErr;
      }

      if (directErr?.isCorsOrNetwork || directErr?.missingEtag) {
        // 1) Try enabling R2 bucket CORS automatically once
        try {
          await api.post('/admin/video/r2/cors');
          await new Promise((r) => setTimeout(r, 300));
          const retriedParts = await uploadMultipartParts({
            file,
            presign,
            useWorkerProxy: false,
            signal,
            onProgress,
          });
          return await completeMultipart(presign, retriedParts);
        } catch (corsOrRetryErr) {
          if (corsOrRetryErr?.isCancelled) {
            api.post('/admin/video/r2/abort', { key: presign.key, upload_id: presign.upload_id }).catch(() => {});
            throw corsOrRetryErr;
          }
          // Abort direct session before switching cleanly to same-origin Worker stream proxy
          await api.post('/admin/video/r2/abort', { key: presign.key, upload_id: presign.upload_id }).catch(() => {});
        }

        // 2) Seamless Same-Origin Worker Chunk Streaming Proxy fallback (zero R2 CORS required)
        presign = await requestPresign(true);
        try {
          const proxyParts = await uploadMultipartParts({
            file,
            presign,
            useWorkerProxy: true,
            signal,
            onProgress,
          });
          return await completeMultipart(presign, proxyParts);
        } catch (proxyErr) {
          api.post('/admin/video/r2/abort', { key: presign.key, upload_id: presign.upload_id }).catch(() => {});
          if (proxyErr?.isCancelled) throw proxyErr;
          throw new Error(proxyErr?.message || getErrorMessage(proxyErr));
        }
      }

      api.post('/admin/video/r2/abort', { key: presign.key, upload_id: presign.upload_id }).catch(() => {});
      throw new Error(directErr?.message || getErrorMessage(directErr));
    }
  }

  if (presign?.mode === 'presigned_r2' && presign.upload_url) {
    const completeSinglePut = async () => {
      if (onProgress) onProgress(99, 'registering', { loaded: file.size, total: file.size });
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
      if (onProgress) onProgress(100, 'done', { loaded: file.size, total: file.size });
      return registered;
    };

    try {
      await putBlobWithProgress(presign.upload_url, file, {
        contentType: file.type || '',
        signal,
        onProgress: (loaded, total) => {
          if (onProgress) {
            const pct = Math.min(98, Math.max(1, Math.round((loaded / Math.max(1, total)) * 100)));
            onProgress(pct, 'uploading', { loaded, total });
          }
        },
      });
      return await completeSinglePut();
    } catch (directErr) {
      if (directErr?.isCancelled) throw directErr;
      if (directErr?.isCorsOrNetwork) {
        if (presign.has_worker_fallback) {
          if (onProgress) onProgress(5, 'uploading', { loaded: 0, total: file.size });
          return uploadViaServerForm({
            file,
            type,
            title,
            quality,
            movieId,
            episodeId,
            autoAttach,
            signal,
            onProgress,
          });
        }
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
    signal,
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
  signal,
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
    signal,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (ev) => {
      if (ev.total && onProgress) {
        const pct = Math.min(98, Math.max(1, Math.round((ev.loaded / ev.total) * 100)));
        onProgress(pct, 'uploading', { loaded: ev.loaded, total: ev.total });
      }
    },
  });
  if (onProgress) onProgress(100, 'done', { loaded: file.size, total: file.size });
  return data;
}
