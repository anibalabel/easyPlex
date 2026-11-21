import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, BookOpen, Star } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';

const emptyManga = () => ({
  name: '',
  original_name: '',
  tmdb_id: '',
  imdb_external_id: '',
  subtitle: '',
  overview: '',
  poster_path: '',
  backdrop_path: '',
  backdrop_path_tv: '',
  preview_path: '',
  trailer_url: '',
  first_air_date: '',
  vote_average: 0,
  active: 1,
  premuim: 0,
  pinned: 0,
  featured: 0,
  newEpisodes: 0,
});

export default function MangasPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyManga());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/mangas/data', { params: { page, q } });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (form.id) {
        await api.put(`/admin/mangas/update/${form.id}`, { manga: form });
        toast.success('Manga updated');
      } else {
        await api.post('/admin/mangas/store', { manga: form });
        toast.success('Manga created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this manga entry?')) return;
    try {
      await api.delete(`/admin/mangas/destroy/${id}`);
      toast.success('Manga deleted');
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
            <BookOpen className="h-6 w-6 text-indigo-500" /> Mangas
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage manga catalog entries and metadata.</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm(emptyManga());
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add Manga
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search mangas..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Manga</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Flags</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data.data || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-xs">
                    No mangas added yet.
                  </td>
                </tr>
              ) : (
                data.data.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {m.poster_path ? (
                          <img src={resolveMediaImage(m.poster_path)} alt={m.name} className="h-12 w-9 rounded object-cover bg-slate-800" />
                        ) : (
                          <div className="h-12 w-9 rounded bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
                            <BookOpen className="h-4 w-4 text-slate-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-semibold">{m.name}</p>
                          <p className="text-xs text-slate-500">{m.first_air_date || 'N/A'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex items-center gap-1 text-amber-500 font-semibold">
                        <Star className="h-3.5 w-3.5 fill-current" />
                        {Number(m.vote_average || 0).toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 space-x-1 text-[11px]">
                      {Number(m.premuim) === 1 && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-500 font-semibold">VIP</span>}
                      {Number(m.featured) === 1 && <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-indigo-500 font-semibold">Featured</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${Number(m.active) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                        {Number(m.active) ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => {
                          setForm({ ...emptyManga(), ...m });
                          setModalOpen(true);
                        }}
                        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4">
          <Pagination meta={data} onPageChange={setPage} />
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Manga' : 'Add Manga'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Manga Title *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Original Name</label>
              <input
                type="text"
                value={form.original_name || ''}
                onChange={(e) => setForm({ ...form, original_name: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Release / Air Date</label>
              <input
                type="text"
                value={form.first_air_date || ''}
                onChange={(e) => setForm({ ...form, first_air_date: e.target.value })}
                placeholder="YYYY-MM-DD"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Trailer / Preview Link</label>
              <input
                type="text"
                value={form.trailer_url || ''}
                onChange={(e) => setForm({ ...form, trailer_url: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <textarea
            rows={3}
            value={form.overview || ''}
            onChange={(e) => setForm({ ...form, overview: e.target.value })}
            placeholder="Synopsis / Overview"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageInput
              label="Poster Image"
              value={form.poster_path}
              onChange={(url) => setForm({ ...form, poster_path: url })}
              uploadEndpoint="/admin/mangas/image/store"
            />
            <ImageInput
              label="Backdrop Image"
              value={form.backdrop_path}
              onChange={(url) => setForm({ ...form, backdrop_path: url })}
              uploadEndpoint="/admin/mangas/image/store"
              aspect="backdrop"
            />
          </div>

          <div className="flex flex-wrap gap-4 text-xs">
            {[
              ['active', 'Active / Published'],
              ['premuim', 'Premium (VIP)'],
              ['featured', 'Featured'],
              ['pinned', 'Pinned'],
              ['newEpisodes', 'New Chapters Badge'],
            ].map(([flag, label]) => (
              <label key={flag} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(Number(form[flag]))}
                  onChange={(e) => setForm({ ...form, [flag]: e.target.checked ? 1 : 0 })}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white">
              {saving ? 'Saving...' : 'Save Manga'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
