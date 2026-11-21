import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Star, ArrowUp, ArrowDown, Sparkles, Eraser } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import ImageInput from '../../components/shared/ImageInput';

const emptyFeatured = () => ({
  title: '',
  featured_id: '',
  type: 'movie',
  genre: '',
  quality: 'HD',
  release_date: '',
  vote_average: '',
  overview: '',
  poster_path: '',
  backdrop_path: '',
  backdrop_path_tv: '',
  premuim: 0,
  enable_miniposter: 0,
  miniposter: '',
  custom: 0,
  custom_link: '',
});

export default function FeaturedPage() {
  const [items, setItems] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyFeatured());
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/featured/data', { params: { per_page: 50 } });
      setItems(data?.data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/admin/featured/update/${form.id}`, { featured: form });
        toast.success('Featured item updated');
      } else {
        await api.post('/admin/featured/store', { featured: form });
        toast.success('Featured item added');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Star className="h-6 w-6 text-amber-500" /> Featured Slider
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure homepage hero slides, ordering, custom banners &amp; VIP badges.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await api.post('/admin/featured/auto-populate');
              toast.success('Auto-populated featured items');
              load();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <Sparkles className="h-3.5 w-3.5" /> Auto-Populate
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Clear all featured items?')) return;
              await api.post('/admin/featured/clear-featured');
              load();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-500"
          >
            <Eraser className="h-3.5 w-3.5" /> Clear All
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(emptyFeatured());
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add Featured
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Pos</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Flags</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-500">No featured entries yet.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-indigo-500 w-6">#{item.position}</span>
                      <button type="button" onClick={async () => { await api.post(`/admin/featured/move-up/${item.id}`); load(); }} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={async () => { await api.post(`/admin/featured/move-down/${item.id}`); load(); }} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowDown className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.poster_path && <img src={resolveMediaImage(item.poster_path)} alt={item.title} className="h-12 w-9 rounded object-cover bg-slate-800" />}
                      <div>
                        <p className="font-semibold">{item.title}</p>
                        <p className="text-xs text-slate-500">{item.genre || item.release_date || ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs uppercase">{item.type}</td>
                  <td className="px-4 py-3 text-xs space-x-1">
                    {Number(item.premuim) === 1 && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-500 font-semibold">VIP</span>}
                    {Number(item.custom) === 1 && <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-cyan-500 font-semibold">Custom URL</span>}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => { setForm({ ...emptyFeatured(), ...item }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={async () => { await api.delete(`/admin/featured/destroy/${item.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Featured Item' : 'Add Featured Item'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="text" required placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <select value={form.type || 'movie'} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
              <option value="movie">Movie</option>
              <option value="serie">Series</option>
              <option value="anime">Anime</option>
              <option value="livetv">Live TV</option>
              <option value="custom">Custom Link</option>
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="number" placeholder="Media ID (optional)" value={form.featured_id || ''} onChange={(e) => setForm({ ...form, featured_id: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Genre Label" value={form.genre || ''} onChange={(e) => setForm({ ...form, genre: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Quality (4K, HD)" value={form.quality || ''} onChange={(e) => setForm({ ...form, quality: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageInput label="Poster" value={form.poster_path} onChange={(url) => setForm({ ...form, poster_path: url })} uploadEndpoint="/admin/featured/image/store" />
            <ImageInput label="Backdrop" value={form.backdrop_path} onChange={(url) => setForm({ ...form, backdrop_path: url, backdrop_path_tv: url })} uploadEndpoint="/admin/featured/image/store" aspect="backdrop" />
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={Boolean(Number(form.premuim))} onChange={(e) => setForm({ ...form, premuim: e.target.checked ? 1 : 0 })} /> VIP Only</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={Boolean(Number(form.custom))} onChange={(e) => setForm({ ...form, custom: e.target.checked ? 1 : 0 })} /> Custom Redirect</label>
          </div>
          {Boolean(Number(form.custom)) && (
            <input type="url" placeholder="https://custom-redirect-url" value={form.custom_link || ''} onChange={(e) => setForm({ ...form, custom_link: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
