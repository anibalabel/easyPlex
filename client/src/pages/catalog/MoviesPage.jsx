import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Film,
  DownloadCloud,
  RefreshCw,
  Captions,
  Play,
  Power,
} from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';
import MediaLinksEditor from '../../components/shared/MediaLinksEditor';
import TmdbImportModal from '../../components/shared/TmdbImportModal';
import { CatalogMediaCell, TmdbInfoCell } from '../../components/shared/TmdbMediaCells';

const emptyMovie = () => ({
  title: '',
  original_name: '',
  tmdb_id: '',
  imdb_external_id: '',
  subtitle: '',
  overview: '',
  poster_path: '',
  backdrop_path: '',
  backdrop_path_tv: '',
  trailer_url: '',
  release_date: '',
  runtime: '',
  vote_average: 0,
  vote_count: 0,
  popularity: 0,
  skiprecap_start_in: 0,
  hasrecap: 0,
  featured: 0,
  premuim: 0,
  active: 1,
  pinned: 0,
  enable_stream: 1,
  enable_media_download: 1,
  enable_ads_unlock: 0,
  genres: [],
  networks: [],
  casterslist: [],
  videos: [],
  downloads: [],
  substitles: [],
});

export default function MoviesPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [allGenres, setAllGenres] = useState([]);
  const [servers, setServers] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyMovie());
  const [sendNotification, setSendNotification] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tmdbOpen, setTmdbOpen] = useState(false);
  const [autoSubOpen, setAutoSubOpen] = useState(false);
  const [autoSub, setAutoSub] = useState({ enabled: 0, default_languages: '["en"]', apply_to_bulk_import: 1, apply_to_manual_add: 1, skip_if_exists: 1, max_subtitles_per_language: 1 });
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/movies/dataweb', {
        params: { page, q, status },
      });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, q, status, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/admin/genres/datagenres').then(({ data: g }) => setAllGenres(g?.data || g || [])).catch(() => {});
    api.get('/admin/servers/dataservers').then(({ data: s }) => setServers(s?.data || s || [])).catch(() => {});
  }, []);

  const openEdit = async (movie) => {
    try {
      const { data: full } = await api.get(`/admin/movies/edit-data/${movie.id}`);
      setForm({
        ...emptyMovie(),
        ...full,
        videos: full.videos || [],
        downloads: full.downloads || [],
        substitles: full.substitles || [],
        genres: full.genres || [],
      });
      setSendNotification(false);
      setModalOpen(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleTmdbSelect = (tmdb) => {
    const trailerKey = tmdb.videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer')?.key;
    const castMapped = (tmdb.credits?.cast || []).slice(0, 12).map((c) => ({
      id: c.id,
      name: c.name,
      original_name: c.original_name,
      profile_path: c.profile_path ? `https://image.tmdb.org/t/p/w300${c.profile_path}` : null,
      character: c.character,
      known_for_department: c.known_for_department,
      gender: c.gender,
      popularity: c.popularity,
      order: c.order,
    }));

    setForm((prev) => ({
      ...prev,
      tmdb_id: tmdb.id,
      title: tmdb.title || prev.title,
      original_name: tmdb.original_title || tmdb.title || prev.original_name,
      imdb_external_id: tmdb.imdb_id || tmdb.external_ids?.imdb_id || prev.imdb_external_id,
      overview: tmdb.overview || prev.overview,
      poster_path: tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : prev.poster_path,
      backdrop_path: tmdb.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}` : prev.backdrop_path,
      backdrop_path_tv: tmdb.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}` : prev.backdrop_path_tv,
      release_date: tmdb.release_date || prev.release_date,
      runtime: tmdb.runtime ? String(tmdb.runtime) : prev.runtime,
      vote_average: tmdb.vote_average || prev.vote_average,
      vote_count: tmdb.vote_count || prev.vote_count,
      popularity: tmdb.popularity || prev.popularity,
      trailer_url: trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : prev.trailer_url,
      genres: (tmdb.genres || []).map((g) => ({ name: g.name })),
      casterslist: castMapped,
    }));
    setModalOpen(true);
  };

  const toggleGenre = (genre) => {
    setForm((prev) => {
      const exists = (prev.genres || []).some((g) => g.id === genre.id || g.name === genre.name);
      return {
        ...prev,
        genres: exists
          ? prev.genres.filter((g) => g.id !== genre.id && g.name !== genre.name)
          : [...(prev.genres || []), { id: genre.id, name: genre.name }],
      };
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        movie: {
          ...form,
          genres: form.genres,
          casterslist: form.casterslist,
        },
        links: form.videos,
        linksDownloads: form.downloads,
        linksSubstitles: form.substitles,
        replace_relations: true,
        notification: sendNotification,
      };
      if (form.id) {
        await api.put(`/admin/moviesmedia/updatemovie/${form.id}`, payload);
        toast.success('Movie updated cleanly');
      } else {
        await api.post('/admin/moviesmedia/storemovie', payload);
        toast.success('Movie created successfully');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (movie) => {
    if (!window.confirm(`Delete movie "${movie.title}"?`)) return;
    try {
      await api.delete(`/admin/movies/destroy/${movie.id}`);
      toast.success('Movie deleted');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleToggleStatus = async (movie) => {
    try {
      await api.post(`/admin/toggle-status/movies/${movie.id}`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const openAutoSubtitle = async () => {
    try {
      const { data: cfg } = await api.get('/admin/auto-subtitle-settings');
      setAutoSub(cfg);
      setAutoSubOpen(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const saveAutoSubtitle = async (e) => {
    e.preventDefault();
    try {
      await api.put('/admin/auto-subtitle-settings', autoSub);
      toast.success('Auto-subtitle settings saved');
      setAutoSubOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Film className="h-6 w-6 text-indigo-500" /> Movies
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage movie catalog, streaming links, downloads, subtitles &amp; TMDB metadata.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openAutoSubtitle}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Captions className="h-4 w-4 text-amber-500" /> Auto-Subtitles
          </button>
          <button
            type="button"
            onClick={() => setTmdbOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <DownloadCloud className="h-4 w-4" /> Import from TMDB
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(emptyMovie());
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add Movie
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search movies by title, original name, TMDB / IMDb ID..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 text-xs">
          {[
            ['', 'All'],
            ['active', 'Active'],
            ['inactive', 'Inactive'],
            ['premium', 'VIP'],
            ['featured', 'Featured'],
          ].map(([val, label]) => (
            <button
              key={val || 'all'}
              type="button"
              onClick={() => {
                setPage(1);
                setStatus(val);
              }}
              className={`rounded-lg px-3 py-1.5 font-semibold transition-colors ${
                status === val ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Movie</th>
                <th className="px-4 py-3">TMDB</th>
                <th className="px-4 py-3">Genres</th>
                <th className="px-4 py-3">Streams</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data.data || []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500 text-xs">
                    No movies match your filters. Click &quot;Add Movie&quot; or &quot;Import from TMDB&quot;.
                  </td>
                </tr>
              ) : (
                data.data.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <CatalogMediaCell
                        title={m.title}
                        originalName={m.original_name}
                        posterPath={m.poster_path}
                        FallbackIcon={Film}
                        isPremium={m.premuim}
                        date={m.release_date}
                        voteAverage={m.vote_average}
                        runtime={m.runtime}
                        overview={m.overview}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <TmdbInfoCell
                        mediaType="movie"
                        tmdbId={m.tmdb_id}
                        imdbId={m.imdb_external_id}
                        voteCount={m.vote_count}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {(m.genres || []).slice(0, 3).map((g) => (
                          <span key={g.id || g.name} className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px]">
                            {g.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-indigo-500">
                        <Play className="h-3.5 w-3.5" /> {(m.videos || []).length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">{Number(m.views || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(m)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          Number(m.active) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'
                        }`}
                      >
                        <Power className="h-3 w-3" />
                        {Number(m.active) ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => openEdit(m)}
                        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m)}
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

      {/* Movie Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? `Edit Movie: ${form.title}` : 'Add New Movie'}
        subtitle="Configure movie metadata, genres, streaming servers, downloads & subtitles"
        size="full"
      >
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold mb-1">Movie Title *</label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">TMDB ID</label>
              <input
                type="number"
                value={form.tmdb_id || ''}
                onChange={(e) => setForm({ ...form, tmdb_id: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
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
              <label className="block text-xs font-semibold mb-1">Release Date</label>
              <input
                type="text"
                value={form.release_date || ''}
                onChange={(e) => setForm({ ...form, release_date: e.target.value })}
                placeholder="YYYY-MM-DD"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-1">Runtime (min)</label>
                <input
                  type="text"
                  value={form.runtime || ''}
                  onChange={(e) => setForm({ ...form, runtime: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Rating</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.vote_average ?? 0}
                  onChange={(e) => setForm({ ...form, vote_average: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              value={form.trailer_url || ''}
              onChange={(e) => setForm({ ...form, trailer_url: e.target.value })}
              placeholder="Trailer URL (YouTube / MP4)"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={form.imdb_external_id || ''}
              onChange={(e) => setForm({ ...form, imdb_external_id: e.target.value })}
              placeholder="IMDb ID (e.g. tt1234567)"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <textarea
            rows={3}
            value={form.overview || ''}
            onChange={(e) => setForm({ ...form, overview: e.target.value })}
            placeholder="Movie Overview / Synopsis"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageInput
              label="Poster Image"
              value={form.poster_path}
              onChange={(url) => setForm({ ...form, poster_path: url })}
              uploadEndpoint="/admin/movies/image/store"
            />
            <ImageInput
              label="Backdrop Image"
              value={form.backdrop_path}
              onChange={(url) => setForm({ ...form, backdrop_path: url, backdrop_path_tv: url })}
              uploadEndpoint="/admin/movies/image/store"
              aspect="backdrop"
            />
          </div>

          <div>
            <p className="text-xs font-semibold mb-2">Genres</p>
            <div className="flex flex-wrap gap-1.5">
              {allGenres.map((g) => {
                const selected = (form.genres || []).some((fg) => fg.id === g.id || fg.name === g.name);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGenre(g)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors ${
                      selected
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs">
            {[
              ['active', 'Active'],
              ['premuim', 'Premium (VIP)'],
              ['featured', 'Featured'],
              ['pinned', 'Pinned'],
              ['enable_stream', 'Enable Streaming'],
              ['enable_media_download', 'Enable Downloads'],
              ['enable_ads_unlock', 'Ads Unlock'],
              ['hasrecap', 'Has Recap Skip'],
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
            {!form.id && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-indigo-500 font-semibold">
                <input
                  type="checkbox"
                  checked={sendNotification}
                  onChange={(e) => setSendNotification(e.target.checked)}
                />
                Send Push Notification
              </label>
            )}
          </div>

          <MediaLinksEditor
            videos={form.videos || []}
            onChangeVideos={(videos) => setForm({ ...form, videos })}
            downloads={form.downloads || []}
            onChangeDownloads={(downloads) => setForm({ ...form, downloads })}
            subtitles={form.substitles || []}
            onChangeSubtitles={(substitles) => setForm({ ...form, substitles })}
            servers={servers}
            mediaType="movie"
            mediaId={form.id || null}
            defaultTitle={form.title || ''}
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white">
              {saving ? 'Saving...' : form.id ? 'Update Movie' : 'Create Movie'}
            </button>
          </div>
        </form>
      </Modal>

      <TmdbImportModal
        open={tmdbOpen}
        onClose={() => setTmdbOpen(false)}
        type="movie"
        onSelect={handleTmdbSelect}
      />

      {/* Auto Subtitle Modal */}
      <Modal open={autoSubOpen} onClose={() => setAutoSubOpen(false)} title="Auto Subtitle Fetching Settings" size="md">
        <form onSubmit={saveAutoSubtitle} className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={Boolean(Number(autoSub.enabled))}
              onChange={(e) => setAutoSub({ ...autoSub, enabled: e.target.checked ? 1 : 0 })}
            />
            Enable OpenSubtitles Auto-Fetch
          </label>
          <div>
            <label className="block text-xs font-semibold mb-1">Default Languages (JSON array or comma-separated)</label>
            <input
              type="text"
              value={autoSub.default_languages || '["en"]'}
              onChange={(e) => setAutoSub({ ...autoSub, default_languages: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(Number(autoSub.apply_to_bulk_import))}
                onChange={(e) => setAutoSub({ ...autoSub, apply_to_bulk_import: e.target.checked ? 1 : 0 })}
              />
              Apply to Bulk Import
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(Number(autoSub.skip_if_exists))}
                onChange={(e) => setAutoSub({ ...autoSub, skip_if_exists: e.target.checked ? 1 : 0 })}
              />
              Skip if Subtitle Exists
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAutoSubOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">
              Close
            </button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
              Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
