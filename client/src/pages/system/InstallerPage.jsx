import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  Database,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  AlertTriangle,
  Copy,
} from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

export default function InstallerPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [form, setForm] = useState({
    host: '',
    port: 3306,
    database: '',
    username: '',
    password: '',
    ssl: false,
  });
  const { toast } = useToast();

  const loadStatus = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/installer-api/status');
      setStatus(data);
      setForm((prev) => ({
        ...prev,
        host: data?.host && data.host !== 'HYPERDRIVE' ? data.host : prev.host,
        port: Number(data?.port || prev.port || 3306),
        database: data?.database || prev.database,
        username: data?.username || prev.username,
        ssl: Boolean(data?.ssl),
      }));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleTest = async (e) => {
    e?.preventDefault();
    setTesting(true);
    setTestResult(null);
    setSaveResult(null);
    try {
      const { data } = await api.post('/installer-api/test-connection', form);
      setTestResult(data);
      toast.success(`MySQL connected (${data.latency_ms} ms)`);
    } catch (err) {
      const errData = err?.response?.data;
      if (errData) {
        setTestResult(errData);
      } else {
        setTestResult({ ok: false, message: getErrorMessage(err) });
      }
      toast.error(errData?.message || getErrorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveResult(null);
    try {
      const { data } = await api.post('/installer-api/save-connection', form);
      setSaveResult(data);
      setTestResult(data);
      if (data.saved_to === 'kv') {
        toast.success('Remote MySQL connection saved!');
        await loadStatus();
      } else {
        toast.success('Connection verified! Copy the DB variables into Cloudflare if CONFIG_KV is not bound.');
      }
    } catch (err) {
      const errData = err?.response?.data;
      setTestResult(errData || { ok: false, message: getErrorMessage(err) });
      toast.error(errData?.message || getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const envSnippet = [
    `DB_HOST=${form.host}`,
    `DB_PORT=${form.port || 3306}`,
    `DB_DATABASE=${form.database}`,
    `DB_USERNAME=${form.username}`,
    `DB_PASSWORD=${form.password}`,
    `DB_SSL=${form.ssl ? 'true' : 'false'}`,
  ].join('\n');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900/90 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="border-b border-slate-800 px-8 py-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/favicon.png" alt="EasyPlex" className="h-10 w-10 rounded-2xl" />
            <div>
              <h1 className="text-lg font-bold">Remote MySQL Connection Setup</h1>
              <p className="text-xs text-slate-400">Cloudflare Workers • Remote Database Only</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Link to="/login" className="rounded-xl border border-slate-700 hover:bg-slate-800 px-3 py-1.5 font-semibold">
              Login
            </Link>
            <Link to="/admin" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 font-semibold text-white">
              Panel
            </Link>
          </div>
        </div>

        <div className="p-8 space-y-6">
          {/* Current Status */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking current remote MySQL status...
            </div>
          ) : status && (
            <div
              className={`rounded-2xl border p-4 space-y-2 ${
                status.connected
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-amber-500/30 bg-amber-500/10'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {status.connected ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                  )}
                  <span>
                    {status.connected
                      ? `Connected (${status.app_name || status.database}, ${status.tables_count} tables, ${status.latency_ms} ms)`
                      : 'Remote MySQL not connected'}
                  </span>
                </div>
                <span className="rounded-lg bg-slate-900/70 px-2.5 py-1 text-[11px] font-mono text-slate-300">
                  source: {status.source} • KV: {status.kv_bound ? 'bound' : 'not bound'}
                </span>
              </div>

              {!status.connected && (
                <div className="text-xs text-amber-200/90 space-y-1">
                  <p className="font-mono">
                    {status.error_code ? `[${status.error_code}] ` : ''}
                    {status.error_message || 'No remote database credentials configured yet.'}
                  </p>
                  {status.hint && <p className="text-slate-300">{status.hint}</p>}
                </div>
              )}
            </div>
          )}

          {/* Connection Form */}
          <form onSubmit={handleSave} className="space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-200">
              <Database className="h-4 w-4 text-indigo-400" /> Remote MySQL Server
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-400 mb-1">DB Host</label>
                <input
                  type="text"
                  required
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="mysql.us.cloudlogin.co"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Port</label>
                <input
                  type="number"
                  required
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value || 3306) })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Database Name</label>
                <input
                  type="text"
                  required
                  value={form.database}
                  onChange={(e) => setForm({ ...form, database: e.target.value })}
                  placeholder="plusmovie_st"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="plusmovie_st"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.ssl}
                onChange={(e) => setForm({ ...form, ssl: e.target.checked })}
              />
              Enable TLS / SSL (`DB_SSL=true`)
            </label>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                disabled={testing || saving}
                onClick={handleTest}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-300"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                Test Connection
              </button>

              <button
                type="submit"
                disabled={testing || saving}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {status?.kv_bound ? 'Verify & Save Connection' : 'Verify Connection'}
              </button>
            </div>
          </form>

          {/* Test / Save Result */}
          {testResult && (
            <div
              className={`rounded-2xl border p-4 text-xs space-y-2 ${
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-sm">
                {testResult.ok ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
                <span>
                  {testResult.ok
                    ? `Success! ${testResult.mysql_version} • ${testResult.tables_count} tables • ${testResult.latency_ms} ms`
                    : `Connection failed (${testResult.code || 'ERROR'})`}
                </span>
              </div>
              {!testResult.ok && (
                <>
                  <p className="font-mono">{testResult.message}</p>
                  {testResult.hint && <p className="text-slate-300">{testResult.hint}</p>}
                </>
              )}
              {saveResult?.saved_to === 'env_required' && (
                <div className="pt-2 space-y-2 border-t border-emerald-500/20">
                  <p className="text-slate-200">
                    To make Cloudflare remember this connection permanently across isolates without re-entering it, bind a KV namespace named <code className="font-mono text-emerald-300">CONFIG_KV</code> OR paste these variables into <strong>Cloudflare Worker -&gt; Settings -&gt; Variables and Secrets</strong>:
                  </p>
                  <div className="relative">
                    <pre className="rounded-xl bg-slate-950 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                      {envSnippet}
                    </pre>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(envSnippet);
                        toast.success('Copied DB variables');
                      }}
                      className="absolute top-2 right-2 rounded-lg bg-slate-800 hover:bg-slate-700 p-1.5 text-slate-300"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
