import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Server,
  FolderLock,
  Settings2,
  Sparkles,
  Loader2,
} from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

const STEPS = ['Welcome', 'Requirements', 'Permissions', 'Configuration', 'Finished'];

export default function InstallerPage() {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState(null);
  const [reqs, setReqs] = useState({ requirements: [], permissions: [], all_passed: true });
  const [form, setForm] = useState({
    app_name: 'EASYPLEX',
    app_url: window.location.origin,
    tmdb_api_key: '',
    admin_name: 'admin',
    admin_email: 'admin@easyplex.com',
    admin_password: '',
    seed_demo: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/installer-api/status').then(({ data }) => {
      setStatus(data);
      setForm((prev) => ({
        ...prev,
        app_name: data?.app_name || 'EASYPLEX',
        app_url: data?.app_url || window.location.origin,
      }));
    }).catch(() => {});

    api.get('/installer-api/requirements').then(({ data }) => {
      setReqs(data);
    }).catch(() => {});
  }, []);

  const handleInstall = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/installer-api/finish', form);
      toast.success('Installation saved!');
      setStep(4);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-900/90 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="border-b border-slate-800 px-8 py-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/favicon.png" alt="EasyPlex" className="h-10 w-10 rounded-2xl" />
            <div>
              <h1 className="text-lg font-bold">EasyPlex 2.4 Installation Wizard</h1>
              <p className="text-xs text-slate-400">SQLite Edition • Local Stack Ready</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {STEPS.map((label, idx) => (
              <div
                key={label}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                  idx === step
                    ? 'bg-indigo-600 text-white'
                    : idx < step
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800 text-slate-500'
                }`}
              >
                {idx + 1}. {label}
              </div>
            ))}
          </div>
        </div>

        <div className="p-8">
          {step === 0 && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-5">
                <h2 className="text-base font-semibold text-white mb-1">Welcome to EasyPlex 2.4 WebPanel</h2>
                <p className="text-sm text-slate-300">
                  This guided wizard verifies runtime requirements, checks local SQLite &amp; file storage permissions, and lets you customize app branding, TMDB API key, and administrator credentials.
                </p>
              </div>
              {status && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-800/70 p-3">
                    <span className="text-slate-400 block">Status</span>
                    <strong className="text-emerald-400">{status.installed ? 'Initialized' : 'Fresh'}</strong>
                  </div>
                  <div className="rounded-xl bg-slate-800/70 p-3">
                    <span className="text-slate-400 block">Database</span>
                    <strong className="text-white">{status.db_driver}</strong>
                  </div>
                  <div className="rounded-xl bg-slate-800/70 p-3">
                    <span className="text-slate-400 block">Runtime</span>
                    <strong className="text-white">{status.node_version}</strong>
                  </div>
                  <div className="rounded-xl bg-slate-800/70 p-3">
                    <span className="text-slate-400 block">TMDB Key</span>
                    <strong className="text-white">{status.tmdb_configured ? 'Set' : 'Not set'}</strong>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between pt-4">
                <Link to="/admin" className="text-xs text-slate-400 hover:text-white">
                  Skip directly to Panel →
                </Link>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Check Requirements <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Server className="h-4 w-4 text-indigo-400" /> Server &amp; Runtime Requirements
              </h2>
              <div className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-950/50">
                {reqs.requirements.map((item) => (
                  <div key={item.name} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span>{item.name}</span>
                    {item.passed ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                        <CheckCircle2 className="h-4 w-4" /> Passed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-400 text-xs font-semibold">
                        <XCircle className="h-4 w-4" /> Failed
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-4">
                <button type="button" onClick={() => setStep(0)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Check Permissions <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <FolderLock className="h-4 w-4 text-indigo-400" /> Directory &amp; Storage Permissions
              </h2>
              <div className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-950/50">
                {reqs.permissions.map((p) => (
                  <div key={p.folder} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{p.folder}</p>
                      <p className="text-xs text-slate-500 font-mono truncate max-w-md">{p.path}</p>
                    </div>
                    <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                      {p.writable ? `Writable (${p.permission})` : 'Read-only'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-4">
                <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Environment &amp; Admin <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <form onSubmit={handleInstall} className="space-y-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-indigo-400" /> App &amp; Administrator Setup
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">App Name</label>
                  <input
                    type="text"
                    required
                    value={form.app_name}
                    onChange={(e) => setForm({ ...form, app_name: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Panel / API URL</label>
                  <input
                    type="url"
                    required
                    value={form.app_url}
                    onChange={(e) => setForm({ ...form, app_url: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">TMDB v3 API Key (Optional)</label>
                  <input
                    type="text"
                    value={form.tmdb_api_key}
                    onChange={(e) => setForm({ ...form, tmdb_api_key: e.target.value })}
                    placeholder="Optional — can also be configured later in App Settings"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Admin Name</label>
                  <input
                    type="text"
                    required
                    value={form.admin_name}
                    onChange={(e) => setForm({ ...form, admin_name: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Admin Email</label>
                  <input
                    type="email"
                    required
                    value={form.admin_email}
                    onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    New Admin Password (leave blank to keep existing)
                  </label>
                  <input
                    type="password"
                    value={form.admin_password}
                    onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
                    placeholder="Current default: ChangeMe!EasyPlex24"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 pt-1">
                <input
                  type="checkbox"
                  checked={form.seed_demo}
                  onChange={(e) => setForm({ ...form, seed_demo: e.target.checked })}
                />
                Ensure sample genres, plans, servers, and demo catalog entries are populated
              </label>

              <div className="flex items-center justify-between pt-4">
                <button type="button" onClick={() => setStep(2)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Finish Installation
                </button>
              </div>
            </form>
          )}

          {step === 4 && (
            <div className="text-center py-6 space-y-4">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold">EasyPlex 2.4 is Ready!</h2>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Database, settings, permissions, and REST API endpoints are initialized cleanly for{' '}
                <strong className="text-white">{form.admin_email}</strong>.
              </p>
              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Open Login
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className="rounded-xl border border-slate-700 hover:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
