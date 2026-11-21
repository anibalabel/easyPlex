import React, { useCallback, useEffect, useState } from 'react';
import { FileVideo, Upload, RotateCcw, XCircle, Trash2, CheckCircle2, Cpu, HardDrive } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Pagination from '../../components/shared/Pagination';

export default function VideoConversionPage() {
  const [jobs, setJobs] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [ffmpegInfo, setFfmpegInfo] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [queueInfo, setQueueInfo] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [title, setTitle] = useState('');
  const [qualities, setQualities] = useState(['720p', '1080p']);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [jRes, qRes, sRes, ffRes] = await Promise.all([
        api.get('/admin/video-jobs', { params: { page } }),
        api.get('/admin/queue/status'),
        api.get('/admin/storage-config'),
        api.get('/admin/video-debug/test-ffmpeg'),
      ]);
      setJobs(jRes.data);
      setQueueInfo(qRes.data);
      setStorageInfo(sRes.data);
      setFfmpegInfo(ffRes.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, toast]);

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
    try {
      const fd = new FormData();
      if (file) fd.append('video', file);
      if (sourceUrl) fd.append('source_url', sourceUrl.trim());
      if (title) fd.append('title', title);
      fd.append('qualities', JSON.stringify(qualities));
      await api.post('/admin/video/upload-with-qualities', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Video registered / uploaded successfully');
      setFile(null);
      setSourceUrl('');
      setTitle('');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileVideo className="h-6 w-6 text-indigo-500" /> Video Conversion &amp; Storage
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Upload media files, inspect multi-quality versions, and monitor queue/FFmpeg status.
        </p>
      </div>

      {/* System Diagnostics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
          <p className="font-semibold flex items-center gap-1.5 text-slate-500"><Cpu className="h-4 w-4 text-indigo-500" /> Worker Queue</p>
          <p className="text-base font-bold text-emerald-500">{queueInfo?.queue_running ? 'Active' : 'Paused'}</p>
          <p className="text-slate-500">Mode: {queueInfo?.worker_mode || 'nodejs-inprocess'} • Jobs: {queueInfo?.counts?.total || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
          <p className="font-semibold flex items-center gap-1.5 text-slate-500"><HardDrive className="h-4 w-4 text-cyan-500" /> Storage Driver</p>
          <p className="text-base font-bold uppercase">{storageInfo?.driver || 'local'}</p>
          <p className="text-slate-500">{storageInfo?.local_files || 0} stored video file(s)</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
          <p className="font-semibold flex items-center gap-1.5 text-slate-500"><CheckCircle2 className="h-4 w-4 text-amber-500" /> FFmpeg Binary</p>
          <p className={`text-base font-bold ${ffmpegInfo?.available ? 'text-emerald-500' : 'text-amber-500'}`}>
            {ffmpegInfo?.available ? 'Detected' : 'Direct Pass-Through Mode'}
          </p>
          <p className="text-slate-500 truncate">{ffmpegInfo?.version || ffmpegInfo?.message}</p>
        </div>
      </div>

      {/* Upload Form */}
      <form onSubmit={handleUpload} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Upload className="h-4 w-4 text-indigo-500" /> Upload or Register Video Source
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input type="text" placeholder="Optional Title" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs" />
          <input type="url" placeholder="Or Source Video URL (https://...)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-slate-500">Target Profiles:</span>
            {['360p', '480p', '720p', '1080p', '4K'].map((q) => (
              <label key={q} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={qualities.includes(q)}
                  onChange={(e) => setQualities((prev) => (e.target.checked ? [...prev, q] : prev.filter((x) => x !== q)))}
                />
                {q}
              </label>
            ))}
          </div>
          <button type="submit" disabled={uploading} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white">
            {uploading ? 'Uploading...' : 'Start Upload'}
          </button>
        </div>
      </form>

      {/* Jobs Table */}
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
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No video processing jobs recorded yet.</td></tr>
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
        <div className="px-4 pb-4"><Pagination meta={jobs} onPageChange={setPage} /></div>
      </div>
    </div>
  );
}
