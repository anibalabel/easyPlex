import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Radio, Play, Power, Crown } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';
import MediaLinksEditor from '../../components/shared/MediaLinksEditor';
import PlayerPreviewModal from '../../components/shared/PlayerPreviewModal';

const emptyChannel = () => ({
  name: '',
  overview: '',
  poster_path: '',
  backdrop_path: '',
  backdrop_path_tv: '',
  link: '',
  featured: 0,
  vip: 0,
  active: 1,
  live: 1,
  hls: 0,
  embed: 0,
  categories: [],
  videos: [],
});

export default function StreamingPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [categories, setCategories] = useState([]);
  const [servers, setServers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyChannel());
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/livetv/data', { params: { page, q } });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/admin/categories/data').then(({ data: c }) => setCategories(c?.data || c || [])).catch(() => {});
    api.get('/admin/servers/dataservers').then(({ data: s }) => setServers(s?.data || s || [])).catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        livetv: { ...form, genres: form.categories },
        links: form.videos,
        replace_relations: true,
      };
      if (form.id) {
        await api.put(`/admin/livetv/update/${form.id}`, payload);
        toast.success('Channel updated');
      } else {
        await api.post('/admin/livetv/store', payload);
        toast.success('Channel created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete channel "${row.name}"?`)) return;
    try {
      await api.delete(`/admin/livetv/destroy/${row.id}`);
      toast.success('Channel deleted');
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
            <Radio className="h-6 w-6 text-cyan-500" /> Live TV &amp; Streaming
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage IPTV channels, categories, HLS/DRM multi-server streams &amp; VIP access.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm(emptyChannel());
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add Channel
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
          placeholder="Search channels..."
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Categories</th>
                <th className="px-4 py-3">Streams</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data.data || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-500">
                    No Live TV channels found.
                  </td>
                </tr>
              ) : (
                data.data.map((ch) => (
                  <tr key={ch.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {ch.poster_path ? (
                          <img src={resolveMediaImage(ch.poster_path)} alt={ch.name} className="h-12 w-12 rounded-xl object-cover bg-slate-800" />
                        ) : (
                          <div className="h-12 w-12 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center">
                            <Radio className="h-5 w-5" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold">{ch.name}</p>
                            {Number(ch.vip) === 1 && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                          </div>
                          <p className="text-xs text-slate-500">{ch.views || 0} views</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {(ch.categories || []).map((c) => (
                          <span key={c.id} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px]">
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {(ch.videos?.[0]?.link || ch.link) && (
                        <button
                          type="button"
                          onClick={() => setPreview({ title: ch.name, url: ch.videos?.[0]?.link || ch.link })}
                          className="inline-flex items-center gap-1 text-indigo-500 hover:underline font-semibold"
                        >
                          <Play className="h-3.5 w-3.5" /> Test ({(ch.videos || []).length || 1})
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.post(`/admin/toggle-status/livetvs/${ch.id}`);
                          load();
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          Number(ch.active) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'
                        }`}
                      >
                        <Power className="h-3 w-3" />
                        {Number(ch.active) ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => {
                          setForm({ ...emptyChannel(), ...ch, categories: ch.categories || [], videos: ch.videos || [] });
                          setModalOpen(true);
                        }}
                        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(ch)}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? `Edit ${form.name}` : 'Add Live TV Channel'} size="xl">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Channel Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Primary Stream URL (Fallback)</label>
              <input
                type="text"
                value={form.link || ''}
                onChange={(e) => setForm({ ...form, link: e.target.value })}
                placeholder="https://.../stream.m3u8"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <textarea
            rows={2}
            value={form.overview || ''}
            onChange={(e) => setForm({ ...form, overview: e.target.value })}
            placeholder="Channel description"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageInput label="Channel Logo / Poster" value={form.poster_path} onChange={(url) => setForm({ ...form, poster_path: url })} uploadEndpoint="/admin/livetv/image/store" aspect="square" />
            <ImageInput label="Backdrop" value={form.backdrop_path} onChange={(url) => setForm({ ...form, backdrop_path: url, backdrop_path_tv: url })} uploadEndpoint="/admin/livetv/image/store" aspect="backdrop" />
          </div>

          <div>
            <p className="text-xs font-semibold mb-2">Categories</p>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const selected = (form.categories || []).some((fc) => fc.id === c.id || fc.name === c.name);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        categories: selected ? prev.categories.filter((x) => x.id !== c.id) : [...(prev.categories || []), c],
                      }))
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium border ${
                      selected ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs">
            {[
              ['active', 'Active'],
              ['vip', 'VIP Only'],
              ['featured', 'Featured'],
              ['hls', 'HLS (.m3u8)'],
              ['embed', 'Embed'],
            ].map(([flag, lbl]) => (
              <label key={flag} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(Number(form[flag]))}
                  onChange={(e) => setForm({ ...form, [flag]: e.target.checked ? 1 : 0 })}
                />
                {lbl}
              </label>
            ))}
          </div>

          <MediaLinksEditor
            videos={form.videos || []}
            onChangeVideos={(videos) => setForm({ ...form, videos })}
            servers={servers}
            showDownloads={false}
            showSubtitles={false}
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white">
              {saving ? 'Saving...' : 'Save Channel'}
            </button>
          </div>
        </form>
      </Modal>

      <PlayerPreviewModal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.title} url={preview?.url} />
    </div>
  );
}
