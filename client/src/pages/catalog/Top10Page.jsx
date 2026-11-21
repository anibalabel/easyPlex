import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Trophy, ArrowUp, ArrowDown, Sparkles, Eraser } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import ImageInput from '../../components/shared/ImageInput';

const emptyTop10 = () => ({
  position: 1,
  title: '',
  type: 'movie',
  media_id: '',
  poster_path: '',
  backdrop_path: '',
  genre: '',
  vote_average: '',
  release_date: '',
  overview: '',
  premium: 0,
});

export default function Top10Page() {
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({ top10_mode: 'manual', top10_auto_criteria: 'views', limit_top10: 10 });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyTop10());
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [listRes, cfgRes] = await Promise.all([
        api.get('/admin/top10/data'),
        api.get('/admin/top10/settings'),
      ]);
      setItems(listRes.data?.data || []);
      setSettings(cfgRes.data || {});
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async (next) => {
    try {
      await api.post('/admin/top10/settings', next);
      setSettings(next);
      toast.success('Top 10 settings saved');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/admin/top10/update/${form.id}`, form);
        toast.success('Top 10 slot updated');
      } else {
        await api.post('/admin/top10/store', form);
        toast.success('Top 10 slot added');
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
            <Trophy className="h-6 w-6 text-amber-500" /> Top 10 Trending Slots
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Curate positions #1–#10 manually or auto-rank by views/rating.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await api.post('/admin/top10/auto-populate');
              toast.success('Auto-populated Top 10');
              load();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <Sparkles className="h-3.5 w-3.5" /> Auto-Populate
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Clear all Top 10 entries?')) return;
              await api.post('/admin/top10/clear');
              load();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-500"
          >
            <Eraser className="h-3.5 w-3.5" /> Clear
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({ ...emptyTop10(), position: items.length + 1 });
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add Slot
          </button>
        </div>
      </div>

      {/* Mode Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center gap-4 text-xs">
        <div>
          <span className="font-semibold mr-2">Ranking Mode:</span>
          <select
            value={settings.top10_mode || 'manual'}
            onChange={(e) => saveSettings({ ...settings, top10_mode: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1"
          >
            <option value="manual">Manual Curated Slots</option>
            <option value="auto">Automatic Ranking</option>
          </select>
        </div>
        <div>
          <span className="font-semibold mr-2">Auto Criteria:</span>
          <select
            value={settings.top10_auto_criteria || 'views'}
            onChange={(e) => saveSettings({ ...settings, top10_auto_criteria: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1"
          >
            <option value="views">Most Viewed</option>
            <option value="rating">Highest Rated</option>
            <option value="recent">Newest Releases</option>
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No Top 10 entries configured.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-7 w-7 rounded-lg bg-amber-500/15 text-amber-500 font-bold text-xs flex items-center justify-center">
                        #{item.position}
                      </span>
                      <button type="button" onClick={async () => { await api.post(`/admin/top10/move-up/${item.id}`); load(); }} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={async () => { await api.post(`/admin/top10/move-down/${item.id}`); load(); }} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowDown className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.poster_path && <img src={resolveMediaImage(item.poster_path)} alt={item.title} className="h-12 w-9 rounded object-cover bg-slate-800" />}
                      <div>
                        <p className="font-semibold">{item.title}</p>
                        <p className="text-xs text-slate-500">{item.genre || ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs uppercase">{item.type}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => { setForm({ ...emptyTop10(), ...item }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={async () => { await api.delete(`/admin/top10/destroy/${item.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Top 10 Slot' : 'Add Top 10 Slot'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="number" min={1} max={10} required value={form.position} onChange={(e) => setForm({ ...form, position: Number(e.target.value) })} placeholder="Position 1-10" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title *" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
              <option value="movie">Movie</option>
              <option value="serie">Series</option>
              <option value="anime">Anime</option>
            </select>
          </div>
          <ImageInput label="Poster Image *" value={form.poster_path} onChange={(url) => setForm({ ...form, poster_path: url })} uploadEndpoint="/admin/top10/image/store" />
          <ImageInput label="Backdrop" value={form.backdrop_path} onChange={(url) => setForm({ ...form, backdrop_path: url })} uploadEndpoint="/admin/top10/image/store" aspect="backdrop" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
