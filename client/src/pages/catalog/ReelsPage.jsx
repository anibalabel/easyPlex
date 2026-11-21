import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Clapperboard, ArrowUp, ArrowDown, Play, Eye, Heart, Upload } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';
import PlayerPreviewModal from '../../components/shared/PlayerPreviewModal';

const emptyReel = () => ({
  title: '',
  subtitle: '',
  description: '',
  media_type: 'movie',
  media_id: 0,
  episode_id: '',
  video_url: '',
  thumbnail_url: '',
  duration: 30,
  quality: '1080p',
  is_active: 1,
});

export default function ReelsPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [stats, setStats] = useState({ total: 0, active: 0, total_views: 0, total_likes: 0 });
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyReel());
  const [mediaQuery, setMediaQuery] = useState('');
  const [mediaHits, setMediaHits] = useState([]);
  const [preview, setPreview] = useState(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [listRes, stRes] = await Promise.all([
        api.get('/admin/reels/data', { params: { page } }),
        api.get('/admin/reels/stats'),
      ]);
      setData(listRes.data);
      setStats(stRes.data || {});
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const searchCatalogMedia = async (val) => {
    setMediaQuery(val);
    if (!val.trim()) {
      setMediaHits([]);
      return;
    }
    try {
      const { data: res } = await api.get('/admin/reels/search-media', { params: { q: val } });
      setMediaHits(res?.data || []);
    } catch {
      setMediaHits([]);
    }
  };

  const handleVideoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('video', file);
    try {
      const { data: up } = await api.post('/admin/reels/video/store', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm((prev) => ({ ...prev, video_url: up.video_url }));
      toast.success('Reel video uploaded');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/admin/reels/update/${form.id}`, form);
        toast.success('Reel updated');
      } else {
        await api.post('/admin/reels/store', form);
        toast.success('Reel created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const move = async (id, dir) => {
    await api.post(`/admin/reels/move-${dir}/${id}`);
    load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this reel?')) return;
    await api.delete(`/admin/reels/destroy/${id}`);
    toast.success('Reel deleted');
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Clapperboard className="h-6 w-6 text-rose-500" /> Reels / Short Videos
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Vertical feed clips linked to movies, series, and episodes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm(emptyReel());
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add Reel
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Total Reels</p>
          <p className="text-xl font-bold mt-1">{stats.total || 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Active Reels</p>
          <p className="text-xl font-bold mt-1 text-emerald-500">{stats.active || 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Total Views</p>
          <p className="text-xl font-bold mt-1">{Number(stats.total_views || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Total Likes</p>
          <p className="text-xl font-bold mt-1 text-rose-500">{Number(stats.total_likes || 0).toLocaleString()}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Reel</th>
              <th className="px-4 py-3">Linked Media</th>
              <th className="px-4 py-3">Metrics</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {(data.data || []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">No reels created yet.</td>
              </tr>
            ) : (
              data.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 space-x-1">
                    <button type="button" onClick={() => move(r.id, 'up')} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => move(r.id, 'down')} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-xs text-slate-500">{r.duration}s • {r.quality}</p>
                  </td>
                  <td className="px-4 py-3 text-xs uppercase">{r.media_type} #{r.media_id}</td>
                  <td className="px-4 py-3 text-xs space-x-3">
                    <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{r.views_count || 0}</span>
                    <span className="inline-flex items-center gap-1 text-rose-500"><Heart className="h-3.5 w-3.5" />{r.likes_count || 0}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.is_active ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                      {r.is_active ? 'Active' : 'Hidden'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => setPreview({ title: r.title, url: r.video_url })} className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-500/10"><Play className="h-4 w-4" /></button>
                    <button type="button" onClick={() => { setForm({ ...emptyReel(), ...r }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => remove(r.id)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 pb-4"><Pagination meta={data} onPageChange={setPage} /></div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Reel' : 'Create Reel'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input type="text" required placeholder="Reel Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Subtitle" value={form.subtitle || ''} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold">Link to Catalog Title (Optional search)</label>
            <input type="text" value={mediaQuery} onChange={(e) => searchCatalogMedia(e.target.value)} placeholder="Type movie / series / anime name..." className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs" />
            {mediaHits.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {mediaHits.map((m) => (
                  <button
                    key={`${m.type}-${m.id}`}
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, media_type: m.type, media_id: m.id, title: prev.title || m.name, thumbnail_url: prev.thumbnail_url || m.poster_path }));
                      setMediaHits([]);
                    }}
                    className="rounded-lg bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-1 text-xs text-indigo-400"
                  >
                    {m.name} ({m.type})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold">Video URL or Upload *</label>
            <div className="flex gap-2">
              <input type="text" required value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://.../reel.mp4" className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold cursor-pointer">
                <Upload className="h-3.5 w-3.5" /> Upload
                <input type="file" accept="video/*" onChange={handleVideoFile} className="hidden" />
              </label>
            </div>
          </div>

          <ImageInput label="Thumbnail URL / Upload" value={form.thumbnail_url} onChange={(url) => setForm({ ...form, thumbnail_url: url })} uploadEndpoint="/admin/reels/thumbnail/store" />

          <div className="grid grid-cols-3 gap-3">
            <input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} placeholder="Duration (s)" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" value={form.quality || ''} onChange={(e) => setForm({ ...form, quality: e.target.value })} placeholder="Quality" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <label className="inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })} /> Active
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save Reel</button>
          </div>
        </form>
      </Modal>

      <PlayerPreviewModal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.title} url={preview?.url} />
    </div>
  );
}
