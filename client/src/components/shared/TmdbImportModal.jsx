import React, { useState } from 'react';
import { Search, Download, Loader2, Film, Star } from 'lucide-react';
import Modal from './Modal';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

export default function TmdbImportModal({ open, onClose, type = 'movie', onSelect }) {
  const [query, setQuery] = useState('');
  const [tmdbIdInput, setTmdbIdInput] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const { toast } = useToast();

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const { data } = await api.get('/admin/tmdb/search', {
        params: { type: type === 'movie' ? 'movie' : 'tv', query: query.trim() },
      });
      setResults(data?.results || []);
    } catch (err) {
      toast.error(getErrorMessage(err, 'TMDB search failed — check TMDB API Key in Settings.'));
    } finally {
      setLoading(false);
    }
  };

  const handleImportById = async (id) => {
    const numId = Number(id || tmdbIdInput);
    if (!numId) return;
    setImportingId(numId);
    try {
      const { data } = await api.get('/admin/tmdb/search', {
        params: {
          type: type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'tv',
          tmdb_id: numId,
          include_episodes: type === 'movie' ? 0 : 1,
        },
      });
      const item = data?.data;
      if (!item) throw new Error('Empty TMDB response');
      onSelect?.(item);
      const seasonsCount = Array.isArray(item.seasons) ? item.seasons.length : 0;
      const episodesCount = Array.isArray(item.seasons)
        ? item.seasons.reduce((acc, s) => acc + (s.episodes?.length || 0), 0)
        : 0;
      toast.success(
        type === 'movie'
          ? `Loaded "${item.title || item.name}" from TMDB`
          : `Loaded "${item.name || item.title}" (${seasonsCount} seasons, ${episodesCount} episodes) from TMDB`
      );
      onClose?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to fetch TMDB item'));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Import ${type === 'movie' ? 'Movie' : type === 'anime' ? 'Anime' : 'Series'} from TMDB`}
      subtitle="Requires TMDB v3 API Key configured in App Settings"
      size="xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <form onSubmit={handleSearch} className="md:col-span-2 flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title on TMDB..."
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </form>

          <div className="flex gap-2">
            <input
              type="number"
              value={tmdbIdInput}
              onChange={(e) => setTmdbIdInput(e.target.value)}
              placeholder="Direct TMDB ID"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!tmdbIdInput || Boolean(importingId)}
              onClick={() => handleImportById(tmdbIdInput)}
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Fetch
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {results.map((r) => (
            <div
              key={r.id}
              className="flex gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 p-2.5"
            >
              {r.poster_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w200${r.poster_path}`}
                  alt={r.title || r.name}
                  className="h-24 w-16 rounded-lg object-cover shrink-0 bg-slate-800"
                />
              ) : (
                <div className="h-24 w-16 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <Film className="h-5 w-5 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {r.title || r.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                    <span>{r.release_date || r.first_air_date || 'N/A'}</span>
                    <span className="inline-flex items-center gap-0.5 text-amber-500">
                      <Star className="h-3 w-3 fill-current" />
                      {Number(r.vote_average || 0).toFixed(1)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                    {r.overview || 'No overview.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={importingId === r.id}
                  onClick={() => handleImportById(r.id)}
                  className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {importingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Use TMDB #{r.id}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
