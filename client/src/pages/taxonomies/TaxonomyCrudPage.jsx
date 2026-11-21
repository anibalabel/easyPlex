import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search, DownloadCloud, Tags, FolderKanban, Layers, Globe, ShieldCheck, Languages } from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import ImageInput from '../../components/shared/ImageInput';

const CONFIGS = {
  genres: {
    title: 'Genres',
    subtitle: 'Manage movie, series, and anime genres (syncable with TMDB).',
    icon: Tags,
    listUrl: '/admin/genres/datagenres',
    createUrl: '/admin/genres/store',
    updateUrl: (id) => `/admin/genres/update/${id}`,
    deleteUrl: (id) => `/admin/genres/destroy/${id}`,
    fetchUrl: '/admin/genres/fetch',
    fields: [
      { key: 'name', label: 'Genre Name', required: true },
      { key: 'logo_path', label: 'Logo URL', type: 'text' },
    ],
  },
  categories: {
    title: 'Live TV Categories',
    subtitle: 'Organize Live TV & IPTV channels by category.',
    icon: FolderKanban,
    listUrl: '/admin/categories/data',
    createUrl: '/admin/categories/store',
    updateUrl: (id) => `/admin/categories/update/${id}`,
    deleteUrl: (id) => `/admin/categories/destroy/${id}`,
    fields: [{ key: 'name', label: 'Category Name', required: true }],
  },
  collections: {
    title: 'Collections',
    subtitle: 'Group related movies or franchises into curated collections.',
    icon: Layers,
    listUrl: '/admin/collections/datawebcollections',
    createUrl: '/admin/collections/store',
    updateUrl: (id) => `/admin/collections/update/${id}`,
    deleteUrl: (id) => `/admin/collections/destroy/${id}`,
    fields: [
      { key: 'name', label: 'Collection Name', required: true },
      { key: 'poster_path', label: 'Poster URL', type: 'text' },
      { key: 'backdrop_path', label: 'Backdrop URL', type: 'text' },
    ],
  },
  networks: {
    title: 'Networks & Studios',
    subtitle: 'Manage streaming networks (Netflix, HBO, Disney+, Crunchyroll).',
    icon: Globe,
    listUrl: '/admin/networks/datanetworks',
    createUrl: '/admin/networks/store',
    updateUrl: (id) => `/admin/networks/update/${id}`,
    deleteUrl: (id) => `/admin/networks/destroy/${id}`,
    fields: [
      { key: 'name', label: 'Network Name', required: true },
      { key: 'origin_country', label: 'Country Code (e.g. US)' },
      { key: 'logo_path', label: 'Logo URL' },
    ],
  },
  certifications: {
    title: 'Content Certifications',
    subtitle: 'Age ratings by country (PG-13, TV-MA, R, etc.).',
    icon: ShieldCheck,
    listUrl: '/admin/certification/data',
    createUrl: '/admin/certification/store',
    updateUrl: (id) => `/admin/certifications/update/${id}`,
    deleteUrl: (id) => `/admin/certifications/destroy/${id}`,
    fetchUrl: '/admin/certification/fetch',
    fields: [
      { key: 'country_code', label: 'Country Code (US, ES...)', required: true },
      { key: 'certification', label: 'Certification Badge (PG-13)', required: true },
      { key: 'meaning', label: 'Description / Meaning' },
    ],
  },
  languages: {
    title: 'Spoken Languages',
    subtitle: 'Manage ISO-639-1 spoken & UI audio languages.',
    icon: Languages,
    listUrl: '/admin/languages/admindata',
    createUrl: '/admin/languages/store',
    updateUrl: (id) => `/admin/languages/update/${id}`,
    deleteUrl: (id) => `/admin/languages/destroy/${id}`,
    fetchUrl: '/admin/languages/fetch',
    uploadEndpoint: '/admin/languages/image/store',
    fields: [
      { key: 'iso_639_1', label: 'ISO 639-1 Code (en, es, fr)', required: true },
      { key: 'english_name', label: 'English Name', required: true },
      { key: 'name', label: 'Native Name' },
      { key: 'logo_path', label: 'Flag / Icon', type: 'image' },
      { key: 'featured', label: 'Featured on Home', type: 'checkbox' },
    ],
  },
};

export default function TaxonomyCrudPage({ kind }) {
  const cfg = CONFIGS[kind];
  const Icon = cfg.icon;
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({});
  const [fetching, setFetching] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(cfg.listUrl, { params: { per_page: 200, q } });
      const list = Array.isArray(data) ? data : data?.data || data?.genres || data?.languages || [];
      setItems(list);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [cfg.listUrl, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(cfg.updateUrl(form.id), form);
        toast.success('Updated successfully');
      } else {
        await api.post(cfg.createUrl, form);
        toast.success('Created successfully');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleFetchTmdb = async () => {
    if (!cfg.fetchUrl) return;
    setFetching(true);
    try {
      const { data } = await api.post(cfg.fetchUrl);
      toast.success(data?.message || 'Synced from TMDB');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setFetching(false);
    }
  };

  const filtered = items.filter((item) => {
    if (!q.trim()) return true;
    const text = `${item.name || ''} ${item.english_name || ''} ${item.certification || ''} ${item.country_code || ''} ${item.iso_639_1 || ''}`.toLowerCase();
    return text.includes(q.trim().toLowerCase());
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Icon className="h-6 w-6 text-indigo-500" /> {cfg.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{cfg.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {cfg.fetchUrl && (
            <button
              type="button"
              disabled={fetching}
              onClick={handleFetchTmdb}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
            >
              <DownloadCloud className="h-4 w-4" /> {fetching ? 'Syncing...' : 'Fetch from TMDB'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setForm({});
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add New
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Filter ${cfg.title.toLowerCase()}...`}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Name / Value</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No entries found.</td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">#{item.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {(item.logo_path || item.poster_path) && (
                        <img
                          src={resolveMediaImage(item.logo_path || item.poster_path)}
                          alt={item.name || item.english_name || ''}
                          className="h-8 w-8 rounded object-cover bg-slate-800"
                        />
                      )}
                      <span className="font-semibold">
                        {item.name || item.english_name || item.certification}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {item.iso_639_1 && <span className="font-mono uppercase mr-2">{item.iso_639_1}</span>}
                    {item.country_code && <span className="font-mono uppercase mr-2">{item.country_code}</span>}
                    {item.origin_country && <span className="font-mono uppercase mr-2">{item.origin_country}</span>}
                    {item.meaning || ''}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button
                      type="button"
                      onClick={() => {
                        setForm({ ...item });
                        setModalOpen(true);
                      }}
                      className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Delete this entry?')) return;
                        await api.delete(cfg.deleteUrl(item.id));
                        load();
                      }}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? `Edit ${cfg.title}` : `Add ${cfg.title}`} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          {cfg.fields.map((f) => {
            if (f.type === 'checkbox') {
              return (
                <label key={f.key} className="flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={Boolean(Number(form[f.key]))}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.checked ? 1 : 0 })}
                  />
                  {f.label}
                </label>
              );
            }
            if (f.type === 'image') {
              return (
                <ImageInput
                  key={f.key}
                  label={f.label}
                  value={form[f.key] || ''}
                  onChange={(url) => setForm({ ...form, [f.key]: url })}
                  uploadEndpoint={cfg.uploadEndpoint}
                  aspect="square"
                />
              );
            }
            return (
              <div key={f.key}>
                <label className="block text-xs font-semibold mb-1">{f.label}</label>
                <input
                  type="text"
                  required={f.required}
                  value={form[f.key] || ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </div>
            );
          })}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">
              Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
