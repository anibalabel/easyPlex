import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileVideo,
  Upload,
  RotateCcw,
  XCircle,
  Trash2,
  Cloud,
  HardDrive,
  RefreshCw,
  Copy,
  Play,
  Search,
  CheckCircle2,
  ShieldCheck,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { formatBytes, uploadVideoDirect } from '../../lib/r2Upload';
import { useToast } from '../../contexts/ToastContext';
import Pagination from '../../components/shared/Pagination';
import PlayerPreviewModal from '../../components/shared/PlayerPreviewModal';

const QUALITY_TAGS = ['Original', '4K', '1080p', '720p', '480p', '360p'];

export default function VideoConversionPage() {
  const [library, setLibrary] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [libPage, setLibPage] = useState(1);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const [jobs, setJobs] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [jobPage, setJobPage] = useState(1);
  const [activeTab, setActiveTab] = useState('library');

  const [storageInfo, setStorageInfo] = useState(null);
  const [preview, setPreview] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [syncingR2, setSyncingR2] = useState(false);
  const [configuringCors, setConfiguringCors] = useState(false);

  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [title, setTitle] = useState('');
  const [mediaType, setMediaType] = useState('movie');
  const [quality, setQuality] = useState('Original');
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [libRes, sRes, jRes] = await Promise.all([
        api.get('/admin/videos/library', { params: { page: libPage, per_page: 15, q, type: typeFilter } }),
        api.get('/admin/storage-config'),
        api.get('/admin/video-jobs', { params: { page: jobPage, per_page: 10 } }),
      ]);
      setLibrary(libRes.data);
      setStorageInfo(sRes.data);
      setJobs(jRes.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [libPage, jobPage, q, typeFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file && !sourceUrl.trim()) {
      toast.error('Select a video file or enter a source URL.');
      return;
    }
    setUploading(true);
    setUploadPct(1);
    try {
      if (file) {
        await uploadVideoDirect({
          file,
          type: mediaType,
          title: title.trim(),
          quality,
          onProgress: (pct) => setUploadPct(pct),
        });
      } else {
        await api.post('/admin/videos/upload', {
          source_url: sourceUrl.trim(),
          title: title.trim(),
          type: mediaType,
          quality,
        });
      }
      toast.success('Video uploaded and registered cleanly');
      setFile(null);
      setSourceUrl('');
      setTitle('');
      setLibPage(1);
      load();
    } catch (err) {
      toast.error(err?.message || getErrorMessage(err));
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const handleSyncR2 = async () => {
    setSyncingR2(true);
    try {
      const { data } = await api.post('/admin/videos/library/sync-r2');
      toast.success(data.message || 'R2 bucket synced');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSyncingR2(false);
    }
  };

  const handleConfigureCors = async () => {
    setConfiguringCors(true);
    try {
      const { data } = await api.post('/admin/video/r2/cors');
      toast.success(data.message || 'R2 CORS configured');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setConfiguringCors(false);
    }
  };

  const handleDeleteLibraryItem = async (item) => {
    if (!window.confirm(`Delete "${item.title || item.original_name}" from library and storage?`)) return;
    try {
      await api.delete(`/admin/videos/library/${item.id}`);
      toast.success('Video deleted');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleCopyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Stream URL copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileVideo className="h-6 w-6 text-indigo-500" /> Video Storage &amp; Cloudflare R2
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Upload video files directly as-is to Cloudflare R2 (no transcoding), register them, and select them when adding movies or episodes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {storageInfo?.r2_configured && (
            <>
              <button
                type="button"
                onClick={handleConfigureCors}
                disabled={configuringCors}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {configuringCors ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
                Enable R2 CORS
              </button>
              <button
                type="button"
                onClick={handleSyncR2}
                disabled={syncingR2}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {syncingR2 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync R2 Bucket
              </button>
            </>
          )}
        </div>
      </div>

      {/* Storage Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
          <p className="font-semibold flex items-center gap-1.5 text-slate-500">
            <Cloud className="h-4 w-4 text-orange-500" /> Cloudflare R2 Status
          </p>
          <p className={`text-base font-bold ${storageInfo?.r2_configured ? 'text-emerald-500' : 'text-amber-500'}`}>
            {storageInfo?.r2_configured ? `Active (${storageInfo.r2_bucket})` : 'Not Configured'}
          </p>
          <p className="text-slate-500 truncate">
            {storageInfo?.r2_configured ? (
              storageInfo.r2_public_url
            ) : (
              <Link to="/admin/settings" className="text-indigo-400 hover:underline inline-flex items-center gap-1">
                Configure R2 in Settings <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
          <p className="font-semibold flex items-center gap-1.5 text-slate-500">
            <HardDrive className="h-4 w-4 text-cyan-500" /> Uploaded Library
          </p>
          <p className="text-base font-bold">{storageInfo?.library_count || 0} video(s)</p>
          <p className="text-slate-500">Total stored: {formatBytes(storageInfo?.library_size_bytes || 0)}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
          <p className="font-semibold flex items-center gap-1.5 text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Upload Mode
          </p>
          <p className="text-base font-bold text-indigo-400">Direct Upload (As-Is)</p>
          <p className="text-slate-500 truncate">No quality conversion — original file preserved cleanly.</p>
        </div>
      </div>

      {/* Direct Upload Form (NO FFmpeg conversion checkboxes) */}
      <form onSubmit={handleUpload} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4 text-indigo-500" /> Upload or Register Video Directly
          </h2>
          <span className="text-xs text-slate-500">
            Uploads original file straight to {storageInfo?.r2_configured ? 'Cloudflare R2' : 'Storage'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Video Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
          />

          <select
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
          >
            <option value="movie">Movies Folder (movies/originals)</option>
            <option value="episode">Series Folder (series/originals)</option>
            <option value="anime">Animes Folder (animes/originals)</option>
            <option value="general">General (videos/uploads)</option>
          </select>

          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            title="Label only (file is uploaded as-is without conversion)"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
          >
            {QUALITY_TAGS.map((qTag) => (
              <option key={qTag} value={qTag}>Quality Label: {qTag}</option>
            ))}
          </select>

          <input
            type="file"
            accept="video/*,.mp4,.mkv,.webm,.mov,.m3u8"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="url"
            placeholder="Or register an existing Video / R2 / HLS URL (https://...)"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="flex-1 min-w-[260px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            {uploading ? `Uploading ${uploadPct}%` : 'Upload & Register Video'}
          </button>
        </div>

        {uploading && (
          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all duration-150" style={{ width: `${uploadPct}%` }} />
            </div>
            <p className="text-xs text-slate-500">
              {uploadPct < 99 ? `Uploading to Cloudflare R2... ${uploadPct}%` : 'Registering video in library...'}
            </p>
          </div>
        )}
      </form>

      {/* Tabs + Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`rounded-lg px-3 py-1.5 font-semibold ${
              activeTab === 'library' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Uploaded Videos ({library.total || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('jobs')}
            className={`rounded-lg px-3 py-1.5 font-semibold ${
              activeTab === 'jobs' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Legacy Jobs ({jobs.total || 0})
          </button>
        </div>

        {activeTab === 'library' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={q}
                onChange={(e) => {
                  setLibPage(1);
                  setQ(e.target.value);
                }}
                placeholder="Search uploaded videos..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-1.5 text-sm"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => {
                setLibPage(1);
                setTypeFilter(e.target.value);
              }}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold"
            >
              <option value="all">All Folders</option>
              <option value="movie">Movies</option>
              <option value="episode">Series</option>
              <option value="anime">Animes</option>
              <option value="general">General</option>
            </select>
          </div>
        )}
      </div>

      {/* Uploaded Library Table */}
      {activeTab === 'library' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Video / Public URL</th>
                <th className="px-4 py-3">Folder &amp; Quality</th>
                <th className="px-4 py-3">Storage / Size</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(library.data || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">
                    No uploaded videos yet. Upload a video above or click &quot;Sync R2 Bucket&quot;.
                  </td>
                </tr>
              ) : (
                library.data.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 max-w-md">
                      <p className="font-semibold truncate">{item.title || item.original_name}</p>
                      <p className="text-xs font-mono text-slate-500 truncate">{item.stream_url}</p>
                      {item.movie_title && (
                        <p className="text-[11px] text-emerald-500 mt-0.5">Movie: {item.movie_title}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs space-y-1">
                      <span className="inline-block rounded-md bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-400">
                        {item.quality || 'Original'}
                      </span>
                      <p className="text-slate-500 font-mono text-[11px]">{item.directory || item.media_type}</p>
                    </td>
                    <td className="px-4 py-3 text-xs space-y-1">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
                          item.storage === 'r2'
                            ? 'bg-orange-500/15 text-orange-400'
                            : 'bg-slate-500/15 text-slate-400'
                        }`}
                      >
                        {item.storage === 'r2' ? 'Cloudflare R2' : item.storage || 'Local'}
                      </span>
                      <p className="text-slate-500">{formatBytes(item.file_size)}</p>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setPreview({ title: item.title || item.original_name, url: item.stream_url })}
                        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                        title="Preview"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyUrl(item.stream_url)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-500/10"
                        title="Copy URL"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLibraryItem(item)}
                        className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"
                        title="Delete from Library & Storage"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-4 pb-4"><Pagination meta={library} onPageChange={setLibPage} /></div>
        </div>
      )}

      {/* Legacy Jobs Table */}
      {activeTab === 'jobs' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Job / File</th>
                <th className="px-4 py-3">Versions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(jobs.data || []).length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No legacy jobs recorded.</td></tr>
              ) : (
                jobs.data.map((j) => (
                  <tr key={j.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{j.original_name || j.job_id}</p>
                      <p className="text-xs font-mono text-slate-500">{j.stream_url || j.video_code}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {(j.versions || []).map((v) => v.quality).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-semibold text-emerald-500">
                        {j.status} ({j.progress}%)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button type="button" onClick={async () => { await api.post(`/admin/video-jobs/${j.job_id}/retry`); load(); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><RotateCcw className="h-4 w-4" /></button>
                      <button type="button" onClick={async () => { await api.post(`/admin/video-jobs/${j.job_id}/cancel`); load(); }} className="rounded-lg p-1.5 text-amber-500 hover:bg-amber-500/10"><XCircle className="h-4 w-4" /></button>
                      <button type="button" onClick={async () => { await api.delete(`/admin/video-jobs/${j.job_id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-4 pb-4"><Pagination meta={jobs} onPageChange={setJobPage} /></div>
        </div>
      )}

      <PlayerPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title}
        url={preview?.url}
      />
    </div>
  );
}
