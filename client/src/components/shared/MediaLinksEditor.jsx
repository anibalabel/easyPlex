import React, { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Play, Film, Download, Captions } from 'lucide-react';
import PlayerPreviewModal from './PlayerPreviewModal';

const emptyVideo = () => ({
  server: 'Default Server',
  quality: '1080p',
  link: '',
  lang: 'en',
  header: '',
  useragent: '',
  is_premium: 0,
  hls: 0,
  embed: 0,
  youtubelink: 0,
  supported_hosts: 0,
  drm: 0,
  drmuuid: '',
  drmlicenceuri: '',
  is_active: 1,
});

const emptyDownload = () => ({
  server: 'Direct Download',
  quality: '1080p',
  link: '',
  lang: 'en',
  header: '',
  useragent: '',
  is_premium: 0,
  external: 0,
  supported_hosts: 0,
  is_active: 1,
});

const emptySubtitle = () => ({
  name: 'English',
  lang: 'en',
  type: 'srt',
  link: '',
  zip: 0,
  status: 1,
});

export default function MediaLinksEditor({
  videos = [],
  onChangeVideos,
  downloads = [],
  onChangeDownloads,
  subtitles = [],
  onChangeSubtitles,
  servers = [],
  showDownloads = true,
  showSubtitles = true,
}) {
  const [tab, setTab] = useState('videos');
  const [preview, setPreview] = useState(null);

  const swapItem = (list, setter, idx, dir) => {
    const next = [...list];
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setter(next);
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('videos')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'videos'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            Streaming Links ({videos.length})
          </button>

          {showDownloads && (
            <button
              type="button"
              onClick={() => setTab('downloads')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'downloads'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              Downloads ({downloads.length})
            </button>
          )}

          {showSubtitles && (
            <button
              type="button"
              onClick={() => setTab('subtitles')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'subtitles'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Captions className="h-3.5 w-3.5" />
              Subtitles ({subtitles.length})
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (tab === 'videos') onChangeVideos([...videos, emptyVideo()]);
            else if (tab === 'downloads') onChangeDownloads([...downloads, emptyDownload()]);
            else onChangeSubtitles([...subtitles, emptySubtitle()]);
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Add {tab === 'videos' ? 'Stream' : tab === 'downloads' ? 'Download' : 'Subtitle'}
        </button>
      </div>

      <div className="p-4 space-y-3">
        {tab === 'videos' && (
          videos.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No streaming links yet. Click &quot;Add Stream&quot;.</p>
          ) : (
            videos.map((v, idx) => (
              <div key={idx} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-indigo-500">Stream #{idx + 1}</span>
                  <div className="flex items-center gap-1">
                    {v.link && (
                      <button
                        type="button"
                        onClick={() => setPreview({ title: v.server || `Stream #${idx + 1}`, url: v.link })}
                        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                        title="Preview Stream"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => swapItem(videos, onChangeVideos, idx, 'up')} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => swapItem(videos, onChangeVideos, idx, 'down')} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeVideos(videos.filter((_, i) => i !== idx))}
                      className="rounded-lg p-1.5 text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                  <input
                    list="ep-servers-list"
                    value={v.server || ''}
                    onChange={(e) => {
                      const next = [...videos];
                      next[idx] = { ...v, server: e.target.value };
                      onChangeVideos(next);
                    }}
                    placeholder="Server (e.g. MP4 / HLS)"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={v.quality || ''}
                    onChange={(e) => {
                      const next = [...videos];
                      next[idx] = { ...v, quality: e.target.value };
                      onChangeVideos(next);
                    }}
                    placeholder="Quality (1080p, 720p, Auto)"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={v.lang || ''}
                    onChange={(e) => {
                      const next = [...videos];
                      next[idx] = { ...v, lang: e.target.value };
                      onChangeVideos(next);
                    }}
                    placeholder="Lang (en, es)"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={v.header || ''}
                    onChange={(e) => {
                      const next = [...videos];
                      next[idx] = { ...v, header: e.target.value };
                      onChangeVideos(next);
                    }}
                    placeholder="Custom Header (Referer)"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                </div>

                <input
                  value={v.link || ''}
                  onChange={(e) => {
                    const next = [...videos];
                    next[idx] = { ...v, link: e.target.value };
                    onChangeVideos(next);
                  }}
                  placeholder="https://... (MP4, M3U8, YouTube, Embed URL)"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                />

                <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
                  {[
                    ['hls', 'HLS (.m3u8)'],
                    ['embed', 'Embed'],
                    ['youtubelink', 'YouTube'],
                    ['supported_hosts', 'Supported Hosts'],
                    ['is_premium', 'Premium Only'],
                    ['drm', 'DRM'],
                    ['is_active', 'Active'],
                  ].map(([flag, label]) => (
                    <label key={flag} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(Number(v[flag]))}
                        onChange={(e) => {
                          const next = [...videos];
                          next[idx] = { ...v, [flag]: e.target.checked ? 1 : 0 };
                          onChangeVideos(next);
                        }}
                        className="rounded border-slate-300 text-indigo-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>

                {Boolean(Number(v.drm)) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                    <input
                      value={v.drmuuid || ''}
                      onChange={(e) => {
                        const next = [...videos];
                        next[idx] = { ...v, drmuuid: e.target.value };
                        onChangeVideos(next);
                      }}
                      placeholder="DRM UUID"
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      value={v.drmlicenceuri || ''}
                      onChange={(e) => {
                        const next = [...videos];
                        next[idx] = { ...v, drmlicenceuri: e.target.value };
                        onChangeVideos(next);
                      }}
                      placeholder="DRM License URI"
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                )}
              </div>
            ))
          )
        )}

        {tab === 'downloads' && showDownloads && (
          downloads.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No download links yet.</p>
          ) : (
            downloads.map((d, idx) => (
              <div key={idx} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-500">Download #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => onChangeDownloads(downloads.filter((_, i) => i !== idx))}
                    className="rounded-lg p-1 text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    value={d.server || ''}
                    onChange={(e) => {
                      const next = [...downloads];
                      next[idx] = { ...d, server: e.target.value };
                      onChangeDownloads(next);
                    }}
                    placeholder="Server Name"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={d.quality || ''}
                    onChange={(e) => {
                      const next = [...downloads];
                      next[idx] = { ...d, quality: e.target.value };
                      onChangeDownloads(next);
                    }}
                    placeholder="Quality (1080p)"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={d.lang || ''}
                    onChange={(e) => {
                      const next = [...downloads];
                      next[idx] = { ...d, lang: e.target.value };
                      onChangeDownloads(next);
                    }}
                    placeholder="Language"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <input
                  value={d.link || ''}
                  onChange={(e) => {
                    const next = [...downloads];
                    next[idx] = { ...d, link: e.target.value };
                    onChangeDownloads(next);
                  }}
                  placeholder="Download URL"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                />
                <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
                  {[
                    ['external', 'External Browser'],
                    ['supported_hosts', 'Supported Hosts'],
                    ['is_premium', 'Premium Only'],
                    ['is_active', 'Active'],
                  ].map(([flag, label]) => (
                    <label key={flag} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(Number(d[flag]))}
                        onChange={(e) => {
                          const next = [...downloads];
                          next[idx] = { ...d, [flag]: e.target.checked ? 1 : 0 };
                          onChangeDownloads(next);
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))
          )
        )}

        {tab === 'subtitles' && showSubtitles && (
          subtitles.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No subtitles attached yet.</p>
          ) : (
            subtitles.map((s, idx) => (
              <div key={idx} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-500">Subtitle #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => onChangeSubtitles(subtitles.filter((_, i) => i !== idx))}
                    className="rounded-lg p-1 text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    value={s.lang || ''}
                    onChange={(e) => {
                      const next = [...subtitles];
                      next[idx] = { ...s, lang: e.target.value, name: e.target.value };
                      onChangeSubtitles(next);
                    }}
                    placeholder="Language (en, es, fr)"
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  />
                  <select
                    value={s.type || 'srt'}
                    onChange={(e) => {
                      const next = [...subtitles];
                      next[idx] = { ...s, type: e.target.value };
                      onChangeSubtitles(next);
                    }}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                  >
                    <option value="srt">SRT</option>
                    <option value="vtt">VTT</option>
                    <option value="ass">ASS</option>
                  </select>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(Number(s.zip))}
                      onChange={(e) => {
                        const next = [...subtitles];
                        next[idx] = { ...s, zip: e.target.checked ? 1 : 0 };
                        onChangeSubtitles(next);
                      }}
                    />
                    ZIP Archive
                  </label>
                </div>
                <input
                  value={s.link || ''}
                  onChange={(e) => {
                    const next = [...subtitles];
                    next[idx] = { ...s, link: e.target.value };
                    onChangeSubtitles(next);
                  }}
                  placeholder="Subtitle URL (.srt / .vtt / .zip)"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            ))
          )
        )}
      </div>

      <datalist id="ep-servers-list">
        {servers.map((srv) => (
          <option key={srv.id} value={srv.name} />
        ))}
      </datalist>

      <PlayerPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title}
        url={preview?.url}
      />
    </div>
  );
}
