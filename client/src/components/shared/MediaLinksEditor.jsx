import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Play,
  Film,
  Download,
  Captions,
  Upload,
  FolderOpen,
  Loader2,
  Cloud,
} from 'lucide-react';
import PlayerPreviewModal from './PlayerPreviewModal';
import VideoLibraryModal from './VideoLibraryModal';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { formatBytes, uploadVideoDirect } from '../../lib/r2Upload';

const emptyVideo = () => ({
  server: '',
  quality: '1080p',
  link: '',
  lang: 'English',
  video_name: '',
  header: '',
  useragent: '',
  hd: 0,
  downloadonly: 0,
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
  server: '',
  quality: '1080p',
  link: '',
  lang: 'English',
  video_name: '',
  header: '',
  useragent: '',
  is_premium: 0,
  youtubelink: 0,
  external: 0,
  supported_hosts: 0,
  is_active: 1,
});

const emptySubtitle = () => ({
  name: 'English',
  lang: 'English',
  type: 'srt',
  link: '',
  zip: 0,
  status: 1,
});

const QUALITY_TAGS = ['Original', '4K', '2K', '1080p', '720p', '480p', '360p', 'HD', 'SD', 'CAM', 'Auto'];
const FALLBACK_SERVERS = ['Cloudflare R2', 'Default Server', 'MP4 Direct', 'HLS Stream', 'Embed'];
const FALLBACK_LANGUAGES = ['English', 'Spanish', 'Latino', 'Castellano', 'French', 'Portuguese', 'German', 'Italian', 'Japanese', 'Korean'];

/**
 * Select dropdown paired with optional custom free-text input so admins can pick
 * from configured database presets OR enter any custom value cleanly.
 */
function PresetComboField({
  label,
  value = '',
  onChange,
  options = [],
  emptyLabel = '— Select —',
  allowEmpty = false,
  customPlaceholder = 'Enter custom value...',
}) {
  const normalized = String(value ?? '');
  const optionValues = useMemo(() => new Set(options.map((o) => String(o.value))), [options]);
  const [forceCustom, setForceCustom] = useState(false);

  const isCustomValue = Boolean(normalized) && !optionValues.has(normalized);
  const showCustomInput = forceCustom || isCustomValue;
  const selectValue = showCustomInput ? '__custom__' : normalized;

  return (
    <div className="space-y-1">
      {label && <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</label>}
      <select
        value={selectValue}
        onChange={(e) => {
          const nextVal = e.target.value;
          if (nextVal === '__custom__') {
            setForceCustom(true);
          } else {
            setForceCustom(false);
            onChange(nextVal);
          }
        }}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
      >
        {(allowEmpty || !optionValues.has('')) && <option value="">{emptyLabel}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        <option value="__custom__">Custom...</option>
      </select>
      {showCustomInput && (
        <input
          type="text"
          value={normalized}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPlaceholder}
          className="w-full rounded-lg border border-indigo-500/40 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
        />
      )}
    </div>
  );
}

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
  mediaType = 'movie',
  mediaId = null,
  defaultTitle = '',
}) {
  const [tab, setTab] = useState('videos');
  const [preview, setPreview] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTargetIdx, setLibraryTargetIdx] = useState(null);
  const [uploadQuality, setUploadQuality] = useState('Original');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [subUploadingIdx, setSubUploadingIdx] = useState(null);
  const fileInputRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const { toast } = useToast();

  // Dynamic DB presets (Servers, DRM Servers, Headers, User Agents, Languages)
  const [dbServers, setDbServers] = useState([]);
  const [dbDrms, setDbDrms] = useState([]);
  const [dbHeaders, setDbHeaders] = useState([]);
  const [dbUserAgents, setDbUserAgents] = useState([]);
  const [dbLanguages, setDbLanguages] = useState([]);

  useEffect(() => {
    let active = true;
    const safeGet = (url) => api.get(url).then((r) => r.data?.data || r.data || []).catch(() => []);
    Promise.all([
      servers?.length ? Promise.resolve(servers) : safeGet('/admin/servers/dataservers'),
      safeGet('/admin/drmservers/drmdataservers'),
      safeGet('/admin/headers/dataheaders'),
      safeGet('/admin/useragents/datausersagentoptions'),
      safeGet('/admin/languages/data'),
    ]).then(([srvList, drmList, hdrList, uaList, langList]) => {
      if (!active) return;
      setDbServers(Array.isArray(srvList) ? srvList : []);
      setDbDrms(Array.isArray(drmList) ? drmList : []);
      setDbHeaders(Array.isArray(hdrList) ? hdrList : []);
      setDbUserAgents(Array.isArray(uaList) ? uaList : []);
      setDbLanguages(Array.isArray(langList) ? langList : []);
    });
    return () => {
      active = false;
    };
  }, [servers]);

  const effectiveServers = useMemo(() => {
    const base = servers?.length ? servers : dbServers;
    const seen = new Set();
    const out = [];
    for (const s of base) {
      const name = String(s?.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ value: name, label: Number(s.status ?? 1) === 0 ? `${name} (Inactive)` : name });
    }
    for (const fallback of FALLBACK_SERVERS) {
      if (!seen.has(fallback)) {
        seen.add(fallback);
        out.push({ value: fallback, label: fallback });
      }
    }
    return out;
  }, [servers, dbServers]);

  const qualityOptions = useMemo(
    () => QUALITY_TAGS.map((q) => ({ value: q, label: q })),
    []
  );

  const languageOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const l of dbLanguages) {
      const val = String(l.english_name || l.name || l.iso_639_1 || '').trim();
      if (!val || seen.has(val)) continue;
      seen.add(val);
      const code = l.iso_639_1 ? ` (${l.iso_639_1})` : '';
      out.push({ value: val, label: `${val}${code}` });
    }
    for (const lang of FALLBACK_LANGUAGES) {
      if (!seen.has(lang)) {
        seen.add(lang);
        out.push({ value: lang, label: lang });
      }
    }
    return out;
  }, [dbLanguages]);

  const headerOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of dbHeaders) {
      const val = String(h?.name || '').trim();
      if (!val || seen.has(val)) continue;
      seen.add(val);
      out.push({ value: val, label: val });
    }
    return out;
  }, [dbHeaders]);

  const userAgentOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const ua of dbUserAgents) {
      const val = String(ua?.name || ua?.url || '').trim();
      if (!val || seen.has(val)) continue;
      seen.add(val);
      out.push({ value: val, label: val });
    }
    return out;
  }, [dbUserAgents]);

  const applySelectedVideo = (item) => {
    const linkUrl = item?.stream_url || '';
    if (!linkUrl) return;
    const isHls = /\.m3u8(\?|$)/i.test(linkUrl) || item.format === 'hls' ? 1 : 0;
    const srv = item.storage === 'r2' ? 'Cloudflare R2' : item.server || effectiveServers[0]?.value || 'Default Server';
    const qual = item.quality || 'Original';
    const vname = item.title || item.original_name || defaultTitle || '';

    if (tab === 'downloads') {
      if (libraryTargetIdx !== null && downloads[libraryTargetIdx]) {
        const next = [...downloads];
        next[libraryTargetIdx] = {
          ...next[libraryTargetIdx],
          server: next[libraryTargetIdx].server || srv,
          quality: qual,
          link: linkUrl,
          video_name: vname,
        };
        onChangeDownloads(next);
      } else {
        onChangeDownloads([
          ...downloads,
          { ...emptyDownload(), server: srv, quality: qual, link: linkUrl, video_name: vname },
        ]);
      }
    } else {
      if (libraryTargetIdx !== null && videos[libraryTargetIdx]) {
        const next = [...videos];
        next[libraryTargetIdx] = {
          ...next[libraryTargetIdx],
          server:
            next[libraryTargetIdx].server === 'Default Server' || !next[libraryTargetIdx].server
              ? srv
              : next[libraryTargetIdx].server,
          quality: qual,
          link: linkUrl,
          hls: isHls,
          video_name: vname,
        };
        onChangeVideos(next);
      } else {
        onChangeVideos([
          ...videos,
          { ...emptyVideo(), server: srv, quality: qual, link: linkUrl, hls: isHls, video_name: vname },
        ]);
      }
    }
    setLibraryTargetIdx(null);
    toast.success('Video link attached cleanly');
  };

  const handleDirectFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploading(true);
    setUploadPct(1);
    setUploadProgressText(`0 B / ${formatBytes(file.size)}`);
    setUploadName(`${file.name} (${formatBytes(file.size)})`);
    try {
      const res = await uploadVideoDirect({
        file,
        type: mediaType || 'movie',
        title: defaultTitle || file.name.replace(/\.[^.]+$/, ''),
        quality: uploadQuality || 'Original',
        movieId: mediaType === 'movie' ? mediaId : null,
        episodeId: mediaType === 'episode' || mediaType === 'anime' ? mediaId : null,
        autoAttach: false,
        signal: controller.signal,
        onProgress: (pct, _phase, meta) => {
          setUploadPct(pct);
          if (meta?.total) {
            setUploadProgressText(`${formatBytes(meta.loaded || 0)} / ${formatBytes(meta.total)}`);
          }
        },
      });
      const streamUrl = res?.stream_url || res?.video_path || '';
      if (streamUrl) {
        applySelectedVideo({
          stream_url: streamUrl,
          storage: res.storage || 'r2',
          server: res.server || 'Cloudflare R2',
          quality: res.quality || uploadQuality || 'Original',
          title: res.video_name || defaultTitle || file.name,
          format: res.hls ? 'hls' : 'mp4',
        });
      }
    } catch (err) {
      if (err?.isCancelled) {
        toast.info('Upload cancelled');
      } else {
        toast.error(err?.message || 'Video upload failed');
      }
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
      setUploadPct(0);
      setUploadProgressText('');
      setUploadName('');
      e.target.value = '';
    }
  };

  const handleSubtitleFileUpload = async (idx, file) => {
    if (!file) return;
    setSubUploadingIdx(idx);
    try {
      const fd = new FormData();
      fd.append('substitle', file);
      const { data } = await api.post('/admin/substitle/store', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const subUrl = data?.substitle_path || '';
      if (subUrl) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const isZip = ext === 'zip' ? 1 : 0;
        const type = ['srt', 'vtt', 'ass'].includes(ext) ? ext : subtitles[idx]?.type || 'srt';
        const next = [...subtitles];
        next[idx] = {
          ...next[idx],
          link: subUrl,
          zip: isZip,
          type,
          name: next[idx]?.name || file.name.replace(/\.[^.]+$/, ''),
        };
        onChangeSubtitles(next);
        toast.success('Subtitle uploaded');
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Subtitle upload failed'));
    } finally {
      setSubUploadingIdx(null);
    }
  };

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
            <span>Streaming Links</span>
            <span>({videos.length})</span>
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
              <span>Downloads</span>
              <span>({downloads.length})</span>
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
              <span>Subtitles</span>
              <span>({subtitles.length})</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(tab === 'videos' || tab === 'downloads') && (
            <>
              <select
                value={uploadQuality}
                onChange={(e) => setUploadQuality(e.target.value)}
                disabled={uploading}
                title="Optional quality label (file uploads directly as-is without transcoding)"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-semibold"
              >
                {QUALITY_TAGS.map((qTag) => (
                  <option key={qTag} value={qTag}>{qTag}</option>
                ))}
              </select>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.mkv,.webm,.mov,.m3u8"
                onChange={handleDirectFileUpload}
                className="hidden"
              />

              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white"
                title="Upload video directly to Cloudflare R2 without conversion"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                {uploading ? `${uploadPct}%` : 'Upload Video (R2)'}
              </button>

              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  setLibraryTargetIdx(null);
                  setLibraryOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-400"
                title="Choose a video already uploaded to Cloudflare R2"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Select Uploaded Video
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              if (tab === 'videos') {
                onChangeVideos([
                  ...videos,
                  {
                    ...emptyVideo(),
                    server: effectiveServers[0]?.value || 'Default Server',
                  },
                ]);
              } else if (tab === 'downloads') {
                onChangeDownloads([
                  ...downloads,
                  {
                    ...emptyDownload(),
                    server: effectiveServers[0]?.value || 'Direct Download',
                  },
                ]);
              } else {
                onChangeSubtitles([...subtitles, emptySubtitle()]);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add {tab === 'videos' ? 'Stream' : tab === 'downloads' ? 'Download' : 'Subtitle'}
          </button>
        </div>
      </div>

      {uploading && (
        <div className="px-4 py-2.5 bg-orange-500/10 border-b border-orange-500/20 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-orange-400">
            <span className="inline-flex items-center gap-1.5 truncate">
              <Upload className="h-3.5 w-3.5 shrink-0" />
              Uploading directly to Cloudflare R2 (as-is, no transcoding): {uploadName}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span>{uploadProgressText ? `${uploadProgressText} (${uploadPct}%)` : `${uploadPct}%`}</span>
              <button
                type="button"
                onClick={() => uploadAbortRef.current?.abort()}
                className="rounded-md bg-rose-500/20 hover:bg-rose-500/30 px-2 py-0.5 text-[11px] font-semibold text-rose-400"
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-orange-500 transition-all duration-150" style={{ width: `${uploadPct}%` }} />
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        {tab === 'videos' && (
          videos.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">
              No streaming links yet. Use &quot;Upload Video (R2)&quot;, &quot;Select Uploaded Video&quot;, or &quot;Add Stream&quot;.
            </p>
          ) : (
            videos.map((v, idx) => (
              <div key={idx} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-indigo-500">Stream #{idx + 1}</span>
                  <div className="flex items-center gap-1">
                    {v.link && (
                      <button
                        type="button"
                        onClick={() => setPreview({ title: v.video_name || v.server || `Stream #${idx + 1}`, url: v.link })}
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
                  <PresetComboField
                    label="Server"
                    value={v.server || ''}
                    onChange={(server) => {
                      const next = [...videos];
                      next[idx] = { ...v, server };
                      onChangeVideos(next);
                    }}
                    options={effectiveServers}
                    emptyLabel="Select Server..."
                    allowEmpty
                    customPlaceholder="Custom Server Name"
                  />

                  <PresetComboField
                    label="Quality"
                    value={v.quality || ''}
                    onChange={(quality) => {
                      const next = [...videos];
                      next[idx] = { ...v, quality };
                      onChangeVideos(next);
                    }}
                    options={qualityOptions}
                    emptyLabel="Select Quality..."
                    allowEmpty
                    customPlaceholder="e.g. 1080p, 4K, Auto"
                  />

                  <PresetComboField
                    label="Language"
                    value={v.lang || ''}
                    onChange={(lang) => {
                      const next = [...videos];
                      next[idx] = { ...v, lang };
                      onChangeVideos(next);
                    }}
                    options={languageOptions}
                    emptyLabel="Select Language..."
                    allowEmpty
                    customPlaceholder="e.g. Spanish, en, es"
                  />

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Video Name</label>
                    <input
                      value={v.video_name || ''}
                      onChange={(e) => {
                        const next = [...videos];
                        next[idx] = { ...v, video_name: e.target.value };
                        onChangeVideos(next);
                      }}
                      placeholder="Optional Video Name / Label"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <PresetComboField
                    label="Header"
                    value={v.header || ''}
                    onChange={(header) => {
                      const next = [...videos];
                      next[idx] = { ...v, header };
                      onChangeVideos(next);
                    }}
                    options={headerOptions}
                    emptyLabel="None (No Custom Header)"
                    allowEmpty
                    customPlaceholder="Referer or Custom Header"
                  />

                  <PresetComboField
                    label="User Agent"
                    value={v.useragent || ''}
                    onChange={(useragent) => {
                      const next = [...videos];
                      next[idx] = { ...v, useragent };
                      onChangeVideos(next);
                    }}
                    options={userAgentOptions}
                    emptyLabel="None (Default User Agent)"
                    allowEmpty
                    customPlaceholder="Custom User-Agent String"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Stream URL</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={v.link || ''}
                      onChange={(e) => {
                        const next = [...videos];
                        next[idx] = { ...v, link: e.target.value };
                        onChangeVideos(next);
                      }}
                      placeholder="https://... (MP4, M3U8, YouTube, Embed URL)"
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setLibraryTargetIdx(idx);
                        setLibraryOpen(true);
                      }}
                      title="Pick from Uploaded R2 Library"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-indigo-500/10 px-2.5 py-1.5 text-xs font-semibold text-indigo-400 shrink-0"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> R2
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
                  {[
                    ['hls', 'HLS (.m3u8)'],
                    ['embed', 'Embed'],
                    ['youtubelink', 'YouTube'],
                    ['supported_hosts', 'Supported Hosts'],
                    ['is_premium', 'Premium Only'],
                    ['drm', 'DRM'],
                    ...(mediaType === 'movie'
                      ? [
                          ['hd', 'HD'],
                          ['downloadonly', 'Download Only'],
                        ]
                      : []),
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                    {dbDrms.length > 0 && (
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">DRM Server Preset</label>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const found = dbDrms.find((d) => String(d.id) === e.target.value);
                            if (!found) return;
                            const next = [...videos];
                            next[idx] = {
                              ...v,
                              drmlicenceuri: found.named || v.drmlicenceuri || '',
                              drmuuid: found.drmuuid || v.drmuuid || '',
                            };
                            onChangeVideos(next);
                          }}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                        >
                          <option value="">Select DRM Server...</option>
                          {dbDrms.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">DRM UUID</label>
                      <input
                        value={v.drmuuid || ''}
                        onChange={(e) => {
                          const next = [...videos];
                          next[idx] = { ...v, drmuuid: e.target.value };
                          onChangeVideos(next);
                        }}
                        placeholder="DRM UUID (e.g. edef8ba9-...)"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">DRM License URI</label>
                      <input
                        value={v.drmlicenceuri || ''}
                        onChange={(e) => {
                          const next = [...videos];
                          next[idx] = { ...v, drmlicenceuri: e.target.value };
                          onChangeVideos(next);
                        }}
                        placeholder="DRM License URI"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                      />
                    </div>
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
              <div key={idx} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-500">Download #{idx + 1}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => swapItem(downloads, onChangeDownloads, idx, 'up')} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => swapItem(downloads, onChangeDownloads, idx, 'down')} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeDownloads(downloads.filter((_, i) => i !== idx))}
                      className="rounded-lg p-1 text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                  <PresetComboField
                    label="Server"
                    value={d.server || ''}
                    onChange={(server) => {
                      const next = [...downloads];
                      next[idx] = { ...d, server };
                      onChangeDownloads(next);
                    }}
                    options={effectiveServers}
                    emptyLabel="Select Server..."
                    allowEmpty
                    customPlaceholder="Custom Server Name"
                  />

                  <PresetComboField
                    label="Quality"
                    value={d.quality || ''}
                    onChange={(quality) => {
                      const next = [...downloads];
                      next[idx] = { ...d, quality };
                      onChangeDownloads(next);
                    }}
                    options={qualityOptions}
                    emptyLabel="Select Quality..."
                    allowEmpty
                    customPlaceholder="e.g. 1080p, Original"
                  />

                  <PresetComboField
                    label="Language"
                    value={d.lang || ''}
                    onChange={(lang) => {
                      const next = [...downloads];
                      next[idx] = { ...d, lang };
                      onChangeDownloads(next);
                    }}
                    options={languageOptions}
                    emptyLabel="Select Language..."
                    allowEmpty
                    customPlaceholder="e.g. Spanish, en, es"
                  />

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Video Name</label>
                    <input
                      value={d.video_name || ''}
                      onChange={(e) => {
                        const next = [...downloads];
                        next[idx] = { ...d, video_name: e.target.value };
                        onChangeDownloads(next);
                      }}
                      placeholder="Optional File Label"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <PresetComboField
                    label="Header"
                    value={d.header || ''}
                    onChange={(header) => {
                      const next = [...downloads];
                      next[idx] = { ...d, header };
                      onChangeDownloads(next);
                    }}
                    options={headerOptions}
                    emptyLabel="None (No Custom Header)"
                    allowEmpty
                    customPlaceholder="Referer or Custom Header"
                  />

                  <PresetComboField
                    label="User Agent"
                    value={d.useragent || ''}
                    onChange={(useragent) => {
                      const next = [...downloads];
                      next[idx] = { ...d, useragent };
                      onChangeDownloads(next);
                    }}
                    options={userAgentOptions}
                    emptyLabel="None (Default User Agent)"
                    allowEmpty
                    customPlaceholder="Custom User-Agent String"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Download URL</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={d.link || ''}
                      onChange={(e) => {
                        const next = [...downloads];
                        next[idx] = { ...d, link: e.target.value };
                        onChangeDownloads(next);
                      }}
                      placeholder="Download URL"
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setLibraryTargetIdx(idx);
                        setLibraryOpen(true);
                      }}
                      title="Pick from Uploaded R2 Library"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-indigo-500/10 px-2.5 py-1.5 text-xs font-semibold text-indigo-400 shrink-0"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> R2
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
                  {[
                    ['external', 'External Browser'],
                    ['youtubelink', 'YouTube'],
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
              <div key={idx} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5">
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <PresetComboField
                    label="Language"
                    value={s.lang || ''}
                    onChange={(lang) => {
                      const next = [...subtitles];
                      next[idx] = { ...s, lang, name: lang || s.name };
                      onChangeSubtitles(next);
                    }}
                    options={languageOptions}
                    emptyLabel="Select Language..."
                    allowEmpty
                    customPlaceholder="e.g. English, es, fr"
                  />

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Format</label>
                    <select
                      value={s.type || 'srt'}
                      onChange={(e) => {
                        const next = [...subtitles];
                        next[idx] = { ...s, type: e.target.value };
                        onChangeSubtitles(next);
                      }}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    >
                      <option value="srt">SRT</option>
                      <option value="vtt">VTT</option>
                      <option value="ass">ASS</option>
                    </select>
                  </div>

                  <div className="space-y-1 flex flex-col justify-end">
                    <div className="flex flex-wrap items-center gap-4 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
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
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={s.status !== undefined ? Boolean(Number(s.status)) : true}
                          onChange={(e) => {
                            const next = [...subtitles];
                            next[idx] = { ...s, status: e.target.checked ? 1 : 0 };
                            onChangeSubtitles(next);
                          }}
                        />
                        Active
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Subtitle URL</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={s.link || ''}
                      onChange={(e) => {
                        const next = [...subtitles];
                        next[idx] = { ...s, link: e.target.value };
                        onChangeSubtitles(next);
                      }}
                      placeholder="Subtitle URL (.srt / .vtt / .zip)"
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-indigo-500/10 px-2.5 py-1.5 text-xs font-semibold text-indigo-400 cursor-pointer shrink-0">
                      {subUploadingIdx === idx ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      <span>Upload</span>
                      <input
                        type="file"
                        accept=".srt,.vtt,.ass,.zip"
                        disabled={subUploadingIdx === idx}
                        onChange={(e) => handleSubtitleFileUpload(idx, e.target.files?.[0])}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>

      <PlayerPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title}
        url={preview?.url}
      />

      <VideoLibraryModal
        open={libraryOpen}
        onClose={() => {
          setLibraryOpen(false);
          setLibraryTargetIdx(null);
        }}
        mediaType={mediaType}
        onSelect={applySelectedVideo}
      />
    </div>
  );
}
