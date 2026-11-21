import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, UserCheck, DownloadCloud } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';

const emptyCast = () => ({
  name: '',
  original_name: '',
  cast_id: '',
  imdb_id: '',
  known_for_department: 'Acting',
  place_of_birth: '',
  birthday: '',
  profile_path: '',
  biography: '',
  gender: 2,
  popularity: 0,
  active: 1,
});

export default function CastersPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyCast());
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const url = q.trim() ? '/admin/searchwebcasts' : '/admin/casters/datawebcaster';
      const { data: res } = await api.get(url, { params: { page, q } });
      if (Array.isArray(res)) {
        setData({ data: res, current_page: 1, last_page: 1, total: res.length });
      } else {
        setData(res);
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchPersonFromTmdb = async () => {
    if (!form.cast_id) return;
    try {
      const { data: person } = await api.get(`/admin/tmdb/person/${form.cast_id}`);
      setForm((prev) => ({
        ...prev,
        name: person.name || prev.name,
        original_name: person.name || prev.original_name,
        imdb_id: person.imdb_id || prev.imdb_id,
        known_for_department: person.known_for_department || prev.known_for_department,
        place_of_birth: person.place_of_birth || prev.place_of_birth,
        birthday: person.birthday || prev.birthday,
        biography: person.biography || prev.biography,
        profile_path: person.profile_path ? `https://image.tmdb.org/t/p/w300${person.profile_path}` : prev.profile_path,
        popularity: Math.round(person.popularity || 0),
        gender: person.gender ?? prev.gender,
      }));
      toast.success('Fetched actor info from TMDB');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/admin/casters/updatecast/${form.id}`, { cast: form });
        toast.success('Caster updated');
      } else {
        await api.post('/admin/casts/store', { cast: form });
        toast.success('Caster created');
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
            <UserCheck className="h-6 w-6 text-indigo-500" /> Casters &amp; Actors
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage actors, directors, biographies, and filmography.</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm(emptyCast());
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add Actor
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="Search actors..."
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Views</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {(data.data || []).length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No casters found.</td></tr>
            ) : (
              data.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {c.profile_path && <img src={resolveMediaImage(c.profile_path)} alt={c.name} className="h-11 w-11 rounded-full object-cover bg-slate-800" />}
                      <div>
                        <p className="font-semibold">{c.name}</p>
                        <p className="text-xs text-slate-500">{c.place_of_birth || c.birthday || ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{c.known_for_department || 'Acting'}</td>
                  <td className="px-4 py-3 text-xs">{c.views || 0}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => { setForm({ ...emptyCast(), ...c }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={async () => { await api.delete(`/admin/casts/destroy/${c.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 pb-4"><Pagination meta={data} onPageChange={setPage} /></div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Caster' : 'Add Caster'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-semibold mb-1">TMDB Person ID</label>
              <input type="number" value={form.cast_id || ''} onChange={(e) => setForm({ ...form, cast_id: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <button type="button" onClick={fetchPersonFromTmdb} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white">
              <DownloadCloud className="h-4 w-4" /> Fetch from TMDB
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input type="text" required placeholder="Actor Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Department (Acting / Directing)" value={form.known_for_department || ''} onChange={(e) => setForm({ ...form, known_for_department: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Birthday (YYYY-MM-DD)" value={form.birthday || ''} onChange={(e) => setForm({ ...form, birthday: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="Place of Birth" value={form.place_of_birth || ''} onChange={(e) => setForm({ ...form, place_of_birth: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <textarea rows={3} placeholder="Biography" value={form.biography || ''} onChange={(e) => setForm({ ...form, biography: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <ImageInput label="Profile Photo" value={form.profile_path} onChange={(url) => setForm({ ...form, profile_path: url })} uploadEndpoint="/admin/casts/image/store" aspect="square" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
