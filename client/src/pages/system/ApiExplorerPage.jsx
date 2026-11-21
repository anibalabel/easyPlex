import React, { useState } from 'react';
import { Code2, Play, Loader2 } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';

const PRESET_ENDPOINTS = [
  { label: 'App Settings', method: 'GET', url: '/api/settings/local-test' },
  { label: 'App Colors', method: 'GET', url: '/api/colors' },
  { label: 'Mobile Home Catalog', method: 'GET', url: '/api/media/homecontent/local-test' },
  { label: 'Mobile Discovery Feed', method: 'GET', url: '/api/media/mobile/local-test' },
  { label: 'Public Reels Feed', method: 'GET', url: '/api/reels' },
  { label: 'Subscription Plans', method: 'GET', url: '/api/plans' },
  { label: 'Payment Methods', method: 'GET', url: '/api/payment-methods' },
  { label: 'Credit Packages', method: 'GET', url: '/api/credit/packages' },
  { label: 'Genres List', method: 'GET', url: '/api/genres/list/local-test' },
  { label: 'VAST Ads Feed', method: 'GET', url: '/api/ads' },
  { label: 'Security Policy', method: 'GET', url: '/api/security/policy' },
];

export default function ApiExplorerPage() {
  const [url, setUrl] = useState(PRESET_ENDPOINTS[0].url);
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState('');

  const runRequest = async (targetUrl = url) => {
    setLoading(true);
    try {
      const { data } = await api.get(targetUrl);
      setResponseText(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    } catch (err) {
      setResponseText(`ERROR: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Code2 className="h-6 w-6 text-indigo-500" /> Client &amp; Mobile REST API Explorer
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Inspect live EasyPlex Android / TV / Web client <code className="font-mono text-xs">/api/*</code> JSON payloads directly.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESET_ENDPOINTS.map((p) => (
          <button
            key={p.url}
            type="button"
            onClick={() => {
              setUrl(p.url);
              runRequest(p.url);
            }}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              url === p.url
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => runRequest()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Test GET
        </button>
      </div>

      <pre className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-emerald-300 p-4 text-xs font-mono overflow-auto max-h-[60vh]">
        {responseText || '// Select an endpoint above or click "Test GET" to inspect JSON output.'}
      </pre>
    </div>
  );
}
