import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, HardDrive, RefreshCw, Search, Play, Check, Film, Loader2 } from 'lucide-react';
import Modal from './Modal';
import Pagination from './Pagination';
import PlayerPreviewModal from './PlayerPreviewModal';
import api, { getErrorMessage } from '../../lib/api';
import { formatBytes } from '../../lib/r2Upload';
import { useToast } from '../../contexts/ToastContext';

export default function VideoLibraryModal({ open, onClose, onSelect, mediaType = 'all' }) {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0, r2_configured: false, r2_bucket: '' });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState(mediaType === 'episode' || mediaType === 'anime' ? mediaType : 'all');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [preview, setPreview] = useState(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const { data: res } = await api.get('/admin/videos/library', {
        params: { page, per_page: 12, q, type: typeFilter },
      });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [open, page, q, typeFilter, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleSyncR2 = async () => {
    setSyncing(true);
    try {
      const { data: res } = await api.post('/admin/videos/library/sync-r2');
      toast.success(res.message || 'R2 bucket scanned');
      setPage(1);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Select Uploaded Video (Cloudflare R2 Library)" size="xl">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                placeholder="Search by title, filename, R2 key or URL..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-3 py-2 text-sm"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => {
                setPage(1);
                setTypeFilter(e.target.value);
              }}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold"
            >
              <option value="all">All Folders</option>
              <option value="movie">Movies</option>
              <option value="episode">Series / Episodes</option>
              <option value="anime">Animes</option>
              <option value="general">General Uploads</option>
            </select>

            {data.r2_configured && (
              <button
                type="button"
                onClick={handleSyncR2}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-2 text-xs font-semibold text-indigo-500 disabled:opacity-50"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync R2 Bucket
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
            {loading ? (
              <div className="py-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading uploaded videos...
              </div>
            ) : (data.data || []).length === 0 ? (
              <div className="py-12 text-center space-y-2 text-xs text-slate-500">
                <Film className="h-8 w-8 mx-auto text-slate-400" />
                <p>No uploaded videos found yet.</p>
                {data.r2_configured && (
                  <p>Upload a video above or click &quot;Sync R2 Bucket&quot; to import existing files from R2.</p>
                )}
              </div>
            ) : (
              data.data.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm truncate">
                        {item.title || item.original_name}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-400">
                        {item.quality || 'Original'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          item.storage === 'r2'
                            ? 'bg-orange-500/15 text-orange-400'
                            : 'bg-slate-500/15 text-slate-400'
                        }`}
                      >
                        {item.storage === 'r2' ? <Cloud className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
                        {item.storage === 'r2' ? 'Cloudflare R2' : item.storage || 'Local'}
                      </span>
                      {Number(item.file_size) > 0 && (
                        <span className="text-[11px] text-slate-400">{formatBytes(item.file_size)}</span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">{item.stream_url}</p>
                    {item.movie_title && (
                      <p className="text-[11px] text-emerald-500 mt-0.5">Linked to Movie: {item.movie_title}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreview({ title: item.title || item.original_name, url: item.stream_url })}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-indigo-500 hover:bg-indigo-500/10"
                      title="Preview Video"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect?.(item);
                        onClose?.();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      <Check className="h-3.5 w-3.5" /> Select Video
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <Pagination meta={data} onPageChange={setPage} />
        </div>
      </Modal>

      <PlayerPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title}
        url={preview?.url}
      />
    </>
  );
}
