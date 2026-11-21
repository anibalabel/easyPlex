import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, CalendarClock } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';

const emptyUpcoming = () => ({
  title: '',
  tmdb_id: '',
  genre: '',
  release_date: '',
  trailer_id: '',
  link: '',
  overview: '',
  poster_path: '',
  backdrop_path: '',
});

export default function UpcomingPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyUpcoming());
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/upcoming/data', { params: { page } });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/admin/upcoming/update/${form.id}`, { upcoming: form });
        toast.success('Upcoming title updated');
      } else {
        await api.post('/admin/upcoming/store', { upcoming: form });
        toast.success('Upcoming title added');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-indigo-500" /> Upcoming Releases
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Promote coming-soon movies and series with trailers.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyUpcoming());
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add Upcoming
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Genre</th>
              <th className="px-4 py-3">Release Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {(data.data || []).length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No upcoming releases yet.</td></tr>
            ) : (
              data.data.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {u.poster_path && <img src={resolveMediaImage(u.poster_path)} alt={u.title} className="h-12 w-9 rounded object-cover bg-slate-800" />}
                      <span className="font-semibold">{u.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{u.genre || '—'}</td>
                  <td className="px-4 py-3 text-xs">{u.release_date || 'TBA'}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => { setForm({ ...emptyUpcoming(), ...u }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={async () => { await api.delete(`/admin/upcoming/destroy/${u.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 pb-4"><Pagination meta={data} onPageChange={setPage} /></div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Upcoming' : 'Add Upcoming'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input type="text" required placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Release Date (YYYY-MM-DD)" value={form.release_date || ''} onChange={(e) => setForm({ ...form, release_date: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Genre" value={form.genre || ''} onChange={(e) => setForm({ ...form, genre: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Trailer YouTube ID or URL" value={form.trailer_id || form.link || ''} onChange={(e) => setForm({ ...form, trailer_id: e.target.value, link: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <textarea rows={3} placeholder="Overview" value={form.overview || ''} onChange={(e) => setForm({ ...form, overview: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageInput label="Poster" value={form.poster_path} onChange={(url) => setForm({ ...form, poster_path: url })} uploadEndpoint="/admin/upcoming/image/store" />
            <ImageInput label="Backdrop" value={form.backdrop_path} onChange={(url) => setForm({ ...form, backdrop_path: url })} uploadEndpoint="/admin/upcoming/image/store" aspect="backdrop" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
