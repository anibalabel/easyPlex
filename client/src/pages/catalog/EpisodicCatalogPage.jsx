import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Tv,
  Sparkles,
  Star,
  DownloadCloud,
  Layers,
  Power,
  Crown,
} from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import ImageInput from '../../components/shared/ImageInput';
import MediaLinksEditor from '../../components/shared/MediaLinksEditor';
import TmdbImportModal from '../../components/shared/TmdbImportModal';

const emptyItem = () => ({
  name: '',
  original_name: '',
  tmdb_id: '',
  imdb_external_id: '',
  subtitle: '',
  overview: '',
  poster_path: '',
  backdrop_path: '',
  backdrop_path_tv: '',
  trailer_url: '',
  first_air_date: '',
  vote_average: 0,
  active: 1,
  premuim: 0,
  featured: 0,
  pinned: 0,
  newEpisodes: 0,
  genres: [],
  seasons: [],
});

export default function EpisodicCatalogPage({ kind = 'serie' }) {
  const isAnime = kind === 'anime';
  const apiBase = isAnime ? '/admin/animes' : '/admin/series';
  const statusType = isAnime ? 'animes' : 'series';
  const label = isAnime ? 'Animes' : 'Series';
  const singular = isAnime ? 'Anime' : 'Series';
  const Icon = isAnime ? Sparkles : Tv;

  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [allGenres, setAllGenres] = useState([]);
  const [servers, setServers] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyItem());
  const [saving, setSaving] = useState(false);
  const [tmdbOpen, setTmdbOpen] = useState(false);

  // Seasons & Episodes Manager Modal
  const [episodesTarget, setEpisodesTarget] = useState(null);
  const [newSeasonForm, setNewSeasonForm] = useState({ season_number: 1, name: 'Season 1' });
  const [editingEpisode, setEditingEpisode] = useState(null);
  const [targetSeasonId, setTargetSeasonId] = useState(null);
  const [importingTmdbSeasons, setImportingTmdbSeasons] = useState(false);
  const [expandedPreviewSeason, setExpandedPreviewSeason] = useState(null);

  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get(`${apiBase}/data`, { params: { page, q, status } });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [apiBase, page, q, status, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/admin/genres/datagenres').then(({ data: g }) => setAllGenres(g?.data || g || [])).catch(() => {});
    api.get('/admin/servers/dataservers').then(({ data: s }) => setServers(s?.data || s || [])).catch(() => {});
  }, []);

  const refreshParentDetail = async (id) => {
    const { data: full } = await api.get(`${apiBase}/edit-data/${id}`);
    setEpisodesTarget(full);
    load();
  };

  const openEdit = async (row) => {
    try {
      const { data: full } = await api.get(`${apiBase}/edit-data/${row.id}`);
      setForm({ ...emptyItem(), ...full });
      setModalOpen(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const openEpisodesManager = async (row) => {
    try {
      await refreshParentDetail(row.id);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const toTmdbUrl = (raw, size = 'w500') => {
    if (!raw) return '';
    return String(raw).startsWith('http') ? raw : `https://image.tmdb.org/t/p/${size}${raw}`;
  };

  const handleTmdbSelect = (tmdb) => {
    const trailerKey = tmdb.videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer')?.key;
    const seasons = (tmdb.seasons || [])
      .filter((s) => Number(s.season_number) > 0)
      .map((s) => ({
        tmdb_id: s.tmdb_id || s.id || null,
        episodes_from_tmdb: true,
        season_number: Number(s.season_number),
        name: s.name || `Season ${s.season_number}`,
        overview: s.overview || '',
        poster_path: toTmdbUrl(s.poster_path, 'w500'),
        air_date: s.air_date || null,
        episodes: Array.isArray(s.episodes)
          ? s.episodes.map((ep) => ({
              tmdb_id: ep.tmdb_id || ep.id || null,
              episodes_from_tmdb: true,
              episode_number: Number(ep.episode_number || 1),
              name: ep.name || `Episode ${ep.episode_number || 1}`,
              overview: ep.overview || '',
              still_path: toTmdbUrl(ep.still_path, 'w500'),
              still_path_tv: toTmdbUrl(ep.still_path_tv || ep.still_path, 'original'),
              air_date: ep.air_date || null,
              vote_average: Number(ep.vote_average || 0),
              vote_count: Number(ep.vote_count || 0),
              enable_stream: 1,
              enable_media_download: 1,
              videos: [],
              downloads: [],
              substitles: [],
            }))
          : [],
      }));

    const castMapped = (tmdb.credits?.cast || []).slice(0, 12).map((c) => ({
      id: c.id,
      name: c.name,
      original_name: c.original_name,
      profile_path: c.profile_path ? toTmdbUrl(c.profile_path, 'w300') : null,
      character: c.character,
      known_for_department: c.known_for_department,
      gender: c.gender,
      popularity: c.popularity,
      order: c.order,
    }));

    const networksMapped = (tmdb.networks || []).map((n) => ({
      id: n.id,
      name: n.name,
      logo_path: n.logo_path ? toTmdbUrl(n.logo_path, 'w300') : null,
      origin_country: n.origin_country || null,
    }));

    const langsMapped = (tmdb.spoken_languages || []).map((l) => ({
      iso_639_1: l.iso_639_1,
      name: l.name,
      english_name: l.english_name,
    }));

    const totalLoadedEpisodes = seasons.reduce((acc, s) => acc + s.episodes.length, 0);

    setForm((prev) => ({
      ...prev,
      tmdb_id: tmdb.id,
      name: tmdb.name || tmdb.title || prev.name,
      original_name: tmdb.original_name || tmdb.name || prev.original_name,
      imdb_external_id: tmdb.external_ids?.imdb_id || prev.imdb_external_id || '',
      overview: tmdb.overview || prev.overview,
      poster_path: toTmdbUrl(tmdb.poster_path, 'w500') || prev.poster_path,
      backdrop_path: toTmdbUrl(tmdb.backdrop_path, 'original') || prev.backdrop_path,
      backdrop_path_tv: toTmdbUrl(tmdb.backdrop_path, 'original') || prev.backdrop_path_tv,
      trailer_url: trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : prev.trailer_url,
      preview_path: trailerKey || prev.preview_path || '',
      first_air_date: tmdb.first_air_date || prev.first_air_date || '',
      last_air_date: tmdb.last_air_date || prev.last_air_date || '',
      vote_average: tmdb.vote_average || 0,
      vote_count: tmdb.vote_count || 0,
      popularity: tmdb.popularity || 0,
      number_of_seasons: seasons.length || tmdb.number_of_seasons || prev.number_of_seasons,
      number_of_episodes: totalLoadedEpisodes || tmdb.number_of_episodes || prev.number_of_episodes,
      genres: (tmdb.genres || []).map((g) => ({ name: g.name })),
      casterslist: castMapped,
      networks: networksMapped,
      spoken_languages: langsMapped,
      seasons,
    }));
    setExpandedPreviewSeason(seasons[0]?.season_number || null);
    setModalOpen(true);
  };

  const handleImportSeasonsFromTmdb = async () => {
    if (!episodesTarget?.id) return;
    setImportingTmdbSeasons(true);
    try {
      const { data: res } = await api.post(`${apiBase}/${episodesTarget.id}/import-seasons`, {
        fetch_episodes: true,
        skip_existing: true,
      });
      toast.success(res.message || 'Seasons & episodes synced from TMDB');
      if (res.data) setEpisodesTarget(res.data);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to sync seasons & episodes from TMDB'));
    } finally {
      setImportingTmdbSeasons(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const key = isAnime ? 'anime' : 'serie';
      const payload = { [key]: form, seasons: form.seasons, replace_relations: true };
      if (form.id) {
        await api.put(`${apiBase}/update/${form.id}`, payload);
        toast.success(`${singular} updated`);
      } else {
        await api.post(`${apiBase}/store`, payload);
        toast.success(`${singular} created`);
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
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    try {
      await api.delete(`${apiBase}/destroy/${row.id}`);
      toast.success(`${singular} deleted`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleAddSeason = async (e) => {
    e.preventDefault();
    if (!episodesTarget) return;
    try {
      await api.post(`${apiBase}/${episodesTarget.id}/seasons`, newSeasonForm);
      toast.success('Season saved');
      setNewSeasonForm({
        season_number: (episodesTarget.seasons?.length || 0) + 2,
        name: `Season ${(episodesTarget.seasons?.length || 0) + 2}`,
      });
      refreshParentDetail(episodesTarget.id);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleDeleteSeason = async (seasonId) => {
    if (!window.confirm('Delete this season and all its episodes?')) return;
    try {
      await api.delete(`${apiBase}/seasons/destroy/${seasonId}`);
      toast.success('Season deleted');
      refreshParentDetail(episodesTarget.id);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleSaveEpisode = async (e) => {
    e.preventDefault();
    try {
      if (editingEpisode.id) {
        await api.put(`${apiBase}/episodes/${editingEpisode.id}`, editingEpisode);
        toast.success('Episode updated');
      } else {
        await api.post(`${apiBase}/seasons/${targetSeasonId}/episodes`, editingEpisode);
        toast.success('Episode created');
      }
      setEditingEpisode(null);
      setTargetSeasonId(null);
      refreshParentDetail(episodesTarget.id);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleDeleteEpisode = async (episodeId) => {
    if (!window.confirm('Delete this episode?')) return;
    try {
      await api.delete(`${apiBase}/episodes/destroy/${episodeId}`);
      toast.success('Episode deleted');
      refreshParentDetail(episodesTarget.id);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Icon className="h-6 w-6 text-indigo-500" /> {label}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage {label.toLowerCase()}, seasons, episodes, video links &amp; TMDB imports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTmdbOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <DownloadCloud className="h-4 w-4" /> Import TMDB
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(emptyItem());
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add {singular}
          </button>
        </div>
      </div>

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
            placeholder={`Search ${label.toLowerCase()}...`}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 text-xs">
          {[
            ['', 'All'],
            ['active', 'Active'],
            ['inactive', 'Inactive'],
            ['premium', 'VIP'],
          ].map(([val, lbl]) => (
            <button
              key={val || 'all'}
              type="button"
              onClick={() => {
                setPage(1);
                setStatus(val);
              }}
              className={`rounded-lg px-3 py-1.5 font-semibold ${
                status === val ? 'bg-indigo-600 text-white' : 'text-slate-500'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">{singular}</th>
                <th className="px-4 py-3">Seasons</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data.data || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500 text-xs">
                    No {label.toLowerCase()} found.
                  </td>
                </tr>
              ) : (
                data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {row.poster_path ? (
                          <img src={resolveMediaImage(row.poster_path)} alt={row.name} className="h-14 w-10 rounded-lg object-cover bg-slate-800" />
                        ) : (
                          <div className="h-14 w-10 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
                            <Icon className="h-4 w-4 text-slate-400" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold">{row.name}</p>
                            {Number(row.premuim) === 1 && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                          </div>
                          <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>{row.first_air_date || 'N/A'}</span>
                            <span className="inline-flex items-center gap-0.5 text-amber-500">
                              <Star className="h-3 w-3 fill-current" /> {Number(row.vote_average || 0).toFixed(1)}
                            </span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openEpisodesManager(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-500 hover:bg-indigo-500/20"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        {(row.seasons || []).length} Seasons •{' '}
                        {(row.seasons || []).reduce((acc, s) => acc + Number(s.episodes_count ?? s.episodes?.length ?? 0), 0)} Eps
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">{Number(row.views || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.post(`/admin/toggle-status/${statusType}/${row.id}`);
                          load();
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          Number(row.active) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'
                        }`}
                      >
                        <Power className="h-3 w-3" />
                        {Number(row.active) ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
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

      {/* Create / Edit Series or Anime */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? `Edit ${singular}` : `Add ${singular}`} size="xl">
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold mb-1">Title *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
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
              <label className="block text-xs font-semibold mb-1">First Air Date</label>
              <input
                type="text"
                value={form.first_air_date || ''}
                onChange={(e) => setForm({ ...form, first_air_date: e.target.value })}
                placeholder="YYYY-MM-DD"
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

          <textarea
            rows={3}
            value={form.overview || ''}
            onChange={(e) => setForm({ ...form, overview: e.target.value })}
            placeholder="Overview"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageInput label="Poster Image" value={form.poster_path} onChange={(url) => setForm({ ...form, poster_path: url })} uploadEndpoint={`${apiBase}/image/store`} />
            <ImageInput label="Backdrop Image" value={form.backdrop_path} onChange={(url) => setForm({ ...form, backdrop_path: url, backdrop_path_tv: url })} uploadEndpoint={`${apiBase}/image/store`} aspect="backdrop" />
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
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        genres: selected
                          ? prev.genres.filter((x) => x.id !== g.id && x.name !== g.name)
                          : [...(prev.genres || []), { id: g.id, name: g.name }],
                      }))
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium border ${
                      selected ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'
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
              ['newEpisodes', 'New Episodes Badge'],
            ].map(([flag, lbl]) => (
              <label key={flag} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(Number(form[flag]))}
                  onChange={(e) => setForm({ ...form, [flag]: e.target.checked ? 1 : 0 })}
                />
                {lbl}
              </label>
            ))}
          </div>

          {(form.seasons || []).length > 0 && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-emerald-500 uppercase tracking-wide">
                    Seasons &amp; Episodes Loaded ({form.seasons.length} Seasons •{' '}
                    {form.seasons.reduce((acc, s) => acc + (s.episodes?.length || 0), 0)} Episodes)
                  </p>
                  <p className="text-xs text-slate-500">
                    All seasons and episodes listed below will be saved with this {singular.toLowerCase()}.
                  </p>
                </div>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {form.seasons.map((s) => {
                  const isExpanded = expandedPreviewSeason === s.season_number;
                  return (
                    <div key={s.season_number} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setExpandedPreviewSeason(isExpanded ? null : s.season_number)}
                          className="font-semibold text-left flex-1 hover:text-indigo-500"
                        >
                          {s.name || `Season ${s.season_number}`} ({s.episodes?.length || 0} episodes)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              seasons: prev.seasons.filter((x) => x.season_number !== s.season_number),
                            }))
                          }
                          className="text-rose-500 hover:underline ml-2"
                        >
                          Remove
                        </button>
                      </div>
                      {isExpanded && (s.episodes || []).length > 0 && (
                        <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2 space-y-1 bg-slate-50 dark:bg-slate-950/50 text-xs">
                          {s.episodes.map((ep) => (
                            <div key={ep.episode_number} className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                              <span className="truncate">
                                <span className="font-semibold text-indigo-500 mr-1.5">E{ep.episode_number}</span>
                                {ep.name}
                              </span>
                              <span className="text-[11px] text-slate-400 shrink-0 ml-2">{ep.air_date || ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white">
              {saving ? 'Saving...' : `Save ${singular}`}
            </button>
          </div>
        </form>
      </Modal>

      {/* Seasons & Episodes Manager Modal */}
      <Modal
        open={Boolean(episodesTarget)}
        onClose={() => {
          setEpisodesTarget(null);
          setEditingEpisode(null);
        }}
        title={episodesTarget ? `Seasons & Episodes — ${episodesTarget.name}` : 'Seasons & Episodes'}
        size="full"
      >
        {episodesTarget && (
          <div className="space-y-6">
            <form onSubmit={handleAddSeason} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Season #</label>
                <input
                  type="number"
                  required
                  value={newSeasonForm.season_number}
                  onChange={(e) => setNewSeasonForm({ ...newSeasonForm, season_number: Number(e.target.value) })}
                  className="w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold mb-1">Season Name</label>
                <input
                  type="text"
                  required
                  value={newSeasonForm.name}
                  onChange={(e) => setNewSeasonForm({ ...newSeasonForm, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
                />
              </div>
              <button type="submit" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white">
                + Add Season
              </button>
              <button
                type="button"
                disabled={!episodesTarget.tmdb_id || importingTmdbSeasons}
                onClick={handleImportSeasonsFromTmdb}
                title={episodesTarget.tmdb_id ? 'Fetch missing seasons & episodes from TMDB' : 'Set a TMDB ID on this record first'}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <DownloadCloud className="h-3.5 w-3.5" />
                {importingTmdbSeasons ? 'Syncing TMDB...' : 'Import / Sync from TMDB'}
              </button>
            </form>

            {editingEpisode && (
              <form onSubmit={handleSaveEpisode} className="rounded-2xl border border-indigo-500/40 bg-indigo-500/5 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-indigo-500">
                    {editingEpisode.id ? `Edit Episode #${editingEpisode.episode_number}` : 'New Episode'}
                  </h3>
                  <button type="button" onClick={() => setEditingEpisode(null)} className="text-xs text-slate-500 hover:text-white">
                    Cancel Edit
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Episode #</label>
                    <input
                      type="number"
                      required
                      value={editingEpisode.episode_number}
                      onChange={(e) => setEditingEpisode({ ...editingEpisode, episode_number: Number(e.target.value) })}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold mb-1">Episode Title</label>
                    <input
                      type="text"
                      required
                      value={editingEpisode.name}
                      onChange={(e) => setEditingEpisode({ ...editingEpisode, name: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>

                <MediaLinksEditor
                  videos={editingEpisode.videos || []}
                  onChangeVideos={(videos) => setEditingEpisode({ ...editingEpisode, videos })}
                  downloads={editingEpisode.downloads || []}
                  onChangeDownloads={(downloads) => setEditingEpisode({ ...editingEpisode, downloads })}
                  subtitles={editingEpisode.substitles || []}
                  onChangeSubtitles={(substitles) => setEditingEpisode({ ...editingEpisode, substitles })}
                  servers={servers}
                />

                <div className="flex justify-end gap-2">
                  <button type="submit" className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white">
                    Save Episode
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-4">
              {(episodesTarget.seasons || []).map((season) => (
                <div key={season.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 dark:bg-slate-800/70 px-4 py-3">
                    <div>
                      <span className="font-bold text-sm">{season.name}</span>
                      <span className="ml-2 text-xs text-slate-500">({(season.episodes || []).length} episodes)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const nextNum = (season.episodes?.length || 0) + 1;
                          setTargetSeasonId(season.id);
                          setEditingEpisode({
                            episode_number: nextNum,
                            name: `Episode ${nextNum}`,
                            overview: '',
                            videos: [],
                            downloads: [],
                            substitles: [],
                          });
                        }}
                        className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-xs font-semibold text-white"
                      >
                        + Add Episode
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSeason(season.id)}
                        className="rounded-lg p-1 text-rose-500 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(season.episodes || []).length === 0 ? (
                      <p className="px-4 py-3 text-xs text-slate-500">No episodes in this season.</p>
                    ) : (
                      season.episodes.map((ep) => (
                        <div key={ep.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                          <div>
                            <span className="font-semibold text-indigo-500 mr-2">E{ep.episode_number}</span>
                            <span className="font-medium">{ep.name}</span>
                            <span className="ml-3 text-xs text-slate-500">{(ep.videos || []).length} streams</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setTargetSeasonId(season.id);
                                setEditingEpisode({ ...ep, videos: ep.videos || [], downloads: ep.downloads || [], substitles: ep.substitles || [] });
                              }}
                              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-500 hover:bg-indigo-500/10"
                            >
                              Edit &amp; Links
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEpisode(ep.id)}
                              className="rounded-lg p-1 text-rose-500 hover:bg-rose-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <TmdbImportModal open={tmdbOpen} onClose={() => setTmdbOpen(false)} type={isAnime ? 'anime' : 'tv'} onSelect={handleTmdbSelect} />
    </div>
  );
}
