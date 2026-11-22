import React, { useState } from 'react';
import { Check, Copy, Crown, ExternalLink, Star } from 'lucide-react';
import { resolveMediaImage } from '../../lib/api';

/**
 * Shared title cell with poster, original TMDB title (if distinct), date, rating, and overview snippet.
 */
export function CatalogMediaCell({
  title,
  originalName,
  posterPath,
  FallbackIcon,
  isPremium,
  date,
  voteAverage,
  runtime,
  overview,
}) {
  const cleanTitle = String(title || '').trim();
  const cleanOriginal = String(originalName || '').trim();
  const showOriginal =
    Boolean(cleanOriginal) && cleanOriginal.toLowerCase() !== cleanTitle.toLowerCase();

  return (
    <div className="flex items-center gap-3 min-w-0">
      {posterPath ? (
        <img
          src={resolveMediaImage(posterPath)}
          alt={cleanTitle}
          className="h-14 w-10 rounded-lg object-cover bg-slate-800 shrink-0"
        />
      ) : (
        <div className="h-14 w-10 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
          {FallbackIcon ? <FallbackIcon className="h-4 w-4 text-slate-400" /> : null}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-semibold truncate max-w-[240px]" title={cleanTitle}>
            {cleanTitle}
          </p>
          {Number(isPremium) === 1 && <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
        </div>
        {showOriginal && (
          <p
            className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px]"
            title={`Original TMDB title: ${cleanOriginal}`}
          >
            {cleanOriginal}
          </p>
        )}
        <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
          <span>{date || 'N/A'}</span>
          <span className="inline-flex items-center gap-0.5 text-amber-500">
            <Star className="h-3 w-3 fill-current" /> {Number(voteAverage || 0).toFixed(1)}
          </span>
          {runtime ? <span>{runtime} min</span> : null}
        </p>
        {overview ? (
          <p
            className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[280px] mt-0.5"
            title={overview}
          >
            {overview}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Displays TMDB ID link, copy button, IMDb ID link, and TMDB vote count for catalog rows.
 */
export function TmdbInfoCell({ mediaType = 'movie', tmdbId, imdbId, voteCount }) {
  const [copied, setCopied] = useState(false);

  const numericTmdbId = Number(tmdbId);
  const hasTmdb = Number.isFinite(numericTmdbId) && numericTmdbId > 0;
  const cleanImdb =
    imdbId && String(imdbId).trim() && String(imdbId).trim() !== '0'
      ? String(imdbId).trim()
      : '';
  const hasImdbLink = /^tt\d+/i.test(cleanImdb);
  const numericVotes = Number(voteCount || 0);

  const handleCopy = async () => {
    if (!hasTmdb) return;
    try {
      await navigator.clipboard?.writeText(String(numericTmdbId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable in non-HTTPS contexts
    }
  };

  return (
    <div className="space-y-1 text-xs">
      {hasTmdb ? (
        <div className="flex items-center gap-1">
          <a
            href={`https://www.themoviedb.org/${mediaType === 'movie' ? 'movie' : 'tv'}/${numericTmdbId}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open on TMDB (#${numericTmdbId})`}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            TMDB #{numericTmdbId}
            <ExternalLink className="h-3 w-3" />
          </a>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy TMDB ID"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      ) : (
        <span className="inline-flex items-center rounded-md border border-slate-500/20 bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-slate-400">
          No TMDB
        </span>
      )}

      {(cleanImdb || numericVotes > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {cleanImdb ? (
            hasImdbLink ? (
              <a
                href={`https://www.imdb.com/title/${encodeURIComponent(cleanImdb)}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono hover:text-amber-500 transition-colors"
                title={`Open on IMDb (${cleanImdb})`}
              >
                {cleanImdb}
              </a>
            ) : (
              <span className="font-mono">{cleanImdb}</span>
            )
          ) : null}
          {numericVotes > 0 && <span>{numericVotes.toLocaleString()} votes</span>}
        </div>
      )}
    </div>
  );
}
