import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Eye, Play } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';
import PlayerPreviewModal from '../../components/shared/PlayerPreviewModal';

const emptyPreview = () => ({ title: '', minicover: '', backdrop_path: '', link: '' });

export default function PreviewsPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyPreview());
  const [preview, setPreview] = useState(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/preview/data', { params: { page } });
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
        await api.put(`/admin/preview/update/${form.id}`, { preview: form });
        toast.success('Preview updated');
      } else {
        await api.post('/admin/preview/store', { preview: form });
        toast.success('Preview created');
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
            <Eye className="h-6 w-6 text-violet-500" /> App Previews / Circular Highlights
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage circular story-style video previews for mobile apps.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyPreview());
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add Preview
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Preview Title</th>
              <th className="px-4 py-3">Video URL</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {(data.data || []).length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-xs text-slate-500">No previews added yet.</td></tr>
            ) : (
              data.data.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {(p.minicover || p.backdrop_path) && (
                        <img src={resolveMediaImage(p.minicover || p.backdrop_path)} alt={p.title} className="h-11 w-11 rounded-full object-cover border border-indigo-500/40" />
                      )}
                      <span className="font-semibold">{p.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono truncate max-w-xs">{p.link || '—'}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {p.link && <button type="button" onClick={() => setPreview({ title: p.title, url: p.link })} className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-500/10"><Play className="h-4 w-4" /></button>}
                    <button type="button" onClick={() => { setForm({ ...emptyPreview(), ...p }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={async () => { await api.delete(`/admin/preview/destroy/${p.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 pb-4"><Pagination meta={data} onPageChange={setPage} /></div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Preview' : 'Add Preview'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <input type="text" required placeholder="Preview Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <input type="text" placeholder="Preview Video URL (MP4/YouTube)" value={form.link || ''} onChange={(e) => setForm({ ...form, link: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
          <ImageInput label="Circle Cover Image" value={form.minicover} onChange={(url) => setForm({ ...form, minicover: url })} uploadEndpoint="/admin/preview/image/store" aspect="square" />
          <ImageInput label="Backdrop Image" value={form.backdrop_path} onChange={(url) => setForm({ ...form, backdrop_path: url })} uploadEndpoint="/admin/preview/image/store" aspect="backdrop" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>

      <PlayerPreviewModal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.title} url={preview?.url} />
    </div>
  );
}
