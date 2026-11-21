import { queryOne } from '../db/mysql.js';
import { env } from '../config/env.js';

export async function getTmdbConfig() {
  const settings = await queryOne(`SELECT tmdb_api_key, tmdb_lang, imdb_cover_path FROM settings ORDER BY id ASC LIMIT 1`);
  const apiKey = (settings?.tmdb_api_key || env.tmdbApiKey || '').trim();
  let langCode = 'en-US';
  try {
    const parsed = typeof settings?.tmdb_lang === 'string' ? JSON.parse(settings.tmdb_lang) : settings?.tmdb_lang;
    if (parsed?.iso_639_1) langCode = parsed.iso_639_1;
  } catch {
    langCode = 'en';
  }
  return {
    apiKey,
    language: langCode,
    configured: Boolean(apiKey),
    imageBaseUrl: settings?.imdb_cover_path || 'https://image.tmdb.org/t/p/w500',
  };
}

export async function tmdbGet(endpointPath, params = {}) {
  const cfg = await getTmdbConfig();
  if (!cfg.apiKey) {
    throw new Error('TMDB API key is not configured in Settings.');
  }
  const url = new URL(`https://api.themoviedb.org/3${endpointPath}`);
  url.searchParams.set('api_key', cfg.apiKey);
  if (!params.language) {
    url.searchParams.set('language', cfg.language);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`TMDB API error (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}
