import React, { useCallback, useEffect, useState } from 'react';
import {
  Settings,
  Save,
  Play,
  CreditCard,
  Megaphone,
  Shield,
  Mail,
  Palette,
  DatabaseBackup,
  Trash,
  FileCode2,
  Loader2,
  Cloud,
} from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import ImageInput from '../../components/shared/ImageInput';

const TABS = [
  { id: 'general', label: 'General & TMDB', icon: Settings },
  { id: 'player', label: 'Player & Embeds', icon: Play },
  { id: 'storage_cdn', label: 'Cloud Storage & CDN', icon: Cloud },
  { id: 'payments', label: 'Payments & Credits', icon: CreditCard },
  { id: 'ads', label: 'Ad Networks', icon: Megaphone },
  { id: 'security', label: 'Security & Gradle', icon: Shield },
  { id: 'mail', label: 'SMTP Mail', icon: Mail },
  { id: 'branding', label: 'Branding & Colors', icon: Palette },
  { id: 'backup', label: 'Backup & Cache', icon: DatabaseBackup },
];

export default function SettingsPage() {
  const [tab, setTab] = useState('general');
  const [settings, setSettings] = useState(null);
  const [mail, setMail] = useState({ mail_driver: 'smtp', mail_host: '', mail_port: 587, mail_username: '', mail_password: '', mail_encryption: 'tls', mail_from_address: '', mail_from_name: '' });
  const [colors, setColors] = useState([]);
  const [toolbarLogo, setToolbarLogo] = useState('app_logo');
  const [gradleProps, setGradleProps] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/settings/data');
      setSettings(data);
      if (data.mail_settings) setMail(data.mail_settings);
      setColors(data.app_colors || []);
      setToolbarLogo(data.toolbar_logo || 'app_logo');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (k, v) => setSettings((prev) => ({ ...prev, [k]: v }));
  const toggleField = (k) => setSettings((prev) => ({ ...prev, [k]: Number(prev?.[k]) ? 0 : 1 }));

  const saveSettings = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await api.put('/admin/settings/update/1', { settings });
      toast.success('Settings saved cleanly');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveMail = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/admin/updateMailSettings', mail);
      toast.success('SMTP settings saved');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveColors = async () => {
    setSaving(true);
    try {
      await api.put('/admin/colors/update', { colors, toolbar_logo: toolbarLogo });
      toast.success('App colors & branding saved');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const downloadBackup = async () => {
    try {
      const res = await api.post('/admin/settings/database-backup', {}, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `easyplex-db-backup.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Database backup downloaded');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const loadGradleProps = async () => {
    try {
      const { data } = await api.get('/admin/settings/mobile-gradle-properties');
      setGradleProps(data?.properties || '');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-6 w-6 text-indigo-500" /> App &amp; Panel Settings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure TMDB, player behavior, payment gateways, ads, security policies, SMTP, branding &amp; backups.
          </p>
        </div>

        {tab !== 'mail' && tab !== 'branding' && tab !== 'backup' && (
          <button
            type="button"
            disabled={saving}
            onClick={saveSettings}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Settings
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'general' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">App Name</label>
              <input type="text" value={settings.app_name || ''} onChange={(e) => setField('app_name', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Base API / Panel URL</label>
              <input type="text" value={settings.url || ''} onChange={(e) => setField('url', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">TMDB API Key (v3)</label>
              <input type="text" value={settings.tmdb_api_key || ''} onChange={(e) => setField('tmdb_api_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Purchase Key / App Code</label>
              <input type="text" value={settings.purchase_key || ''} onChange={(e) => setField('purchase_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Android Package Name</label>
              <input type="text" value={settings.app_packagename || ''} onChange={(e) => setField('app_packagename', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">TMDB Cover Base URL</label>
              <input type="text" value={settings.imdb_cover_path || ''} onChange={(e) => setField('imdb_cover_path', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Maintenance Message</label>
              <input type="text" value={settings.mantenance_mode_message || ''} onChange={(e) => setField('mantenance_mode_message', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Privacy Policy URL</label>
              <input type="text" value={settings.privacy_policy || ''} onChange={(e) => setField('privacy_policy', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="flex flex-wrap gap-5 text-xs pt-2">
            {[
              ['mantenance_mode', 'Maintenance Mode'],
              ['force_login', 'Force Login'],
              ['email_verify', 'Require Email Verification'],
              ['livetv', 'Enable Live TV'],
              ['anime', 'Enable Animes Section'],
              ['enable_upcoming', 'Enable Upcoming'],
              ['enable_previews', 'Enable Previews'],
              ['enable_collections', 'Enable Collections'],
              ['rtl_support', 'RTL Support'],
              ['telescope_enabled', 'Telescope Logging'],
            ].map(([k, lbl]) => (
              <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={Boolean(Number(settings[k]))} onChange={() => toggleField(k)} />
                {lbl}
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === 'player' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Default Player User-Agent</label>
              <input type="text" value={settings.user_agent || ''} onChange={(e) => setField('user_agent', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Next Episode Timer (sec)</label>
              <input type="number" value={settings.next_episode_timer || 15} onChange={(e) => setField('next_episode_timer', Number(e.target.value))} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">VAST Midroll Offset (sec)</label>
              <input type="number" value={settings.vast_midroll_time_seconds || 60} onChange={(e) => setField('vast_midroll_time_seconds', Number(e.target.value))} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="flex flex-wrap gap-5 text-xs">
            {[
              ['ads_player', 'VAST Player Ads'],
              ['auto_play_next_media', 'Auto-Play Next Episode'],
              ['pip_enable', 'Picture-in-Picture (PiP)'],
              ['enable_vlc', 'External VLC Support'],
              ['enable_download', 'Enable App Downloads'],
              ['download_premuim_only', 'Downloads VIP Only'],
              ['enable_comments', 'Enable Comments'],
              ['reels', 'Enable Reels Tab'],
              ['credits_system_enabled', 'Enable Credits / PPV System'],
              ['premium_users_bypass_credits', 'VIP Bypasses Credits'],
              ['vidsrc', 'Enable VidSrc Embeds'],
              ['inject_embed', 'Inject Embed Servers'],
            ].map(([k, lbl]) => (
              <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={Boolean(Number(settings[k]))} onChange={() => toggleField(k)} />
                {lbl}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label className="block text-xs font-semibold mb-1">VidSrc Endpoint URL</label>
              <input type="text" value={settings.vidsrc_endpoint || ''} onChange={(e) => setField('vidsrc_endpoint', e.target.value)} placeholder="https://vidsrc.to/embed" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Default Embed Provider</label>
              <input type="text" value={settings.default_embed || ''} onChange={(e) => setField('default_embed', e.target.value)} placeholder="vidsrc" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
          </div>
        </div>
      )}

      {tab === 'storage_cdn' && (
        <div className="space-y-6">
          {/* Cloudflare R2 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Cloudflare R2 Storage</h3>
              <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input type="checkbox" checked={Boolean(Number(settings.r2_storage))} onChange={() => toggleField('r2_storage')} />
                Enable R2 Storage
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1">R2 Access Key ID</label>
                <input type="text" value={settings.r2_access_key_id || ''} onChange={(e) => setField('r2_access_key_id', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">R2 Secret Access Key</label>
                <input type="password" value={settings.r2_secret_access_key || ''} onChange={(e) => setField('r2_secret_access_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">R2 Bucket</label>
                <input type="text" value={settings.r2_bucket || ''} onChange={(e) => setField('r2_bucket', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">R2 Endpoint URL</label>
                <input type="text" value={settings.r2_endpoint || ''} onChange={(e) => setField('r2_endpoint', e.target.value)} placeholder="https://<accountid>.r2.cloudflarestorage.com" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1">R2 Public URL</label>
                <input type="text" value={settings.r2_public_url || ''} onChange={(e) => setField('r2_public_url', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
            </div>
          </div>

          {/* Bunny.net Storage */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Bunny.net Edge Storage</h3>
              <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input type="checkbox" checked={Boolean(Number(settings.bunny_storage))} onChange={() => toggleField('bunny_storage')} />
                Enable Bunny Storage
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Bunny Storage Zone</label>
                <input type="text" value={settings.bunny_storage_zone || ''} onChange={(e) => setField('bunny_storage_zone', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Bunny Access Key</label>
                <input type="password" value={settings.bunny_access_key || ''} onChange={(e) => setField('bunny_access_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Bunny Endpoint Host</label>
                <input type="text" value={settings.bunny_endpoint || ''} onChange={(e) => setField('bunny_endpoint', e.target.value)} placeholder="storage.bunnycdn.com" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Bunny Public Pull URL</label>
                <input type="text" value={settings.bunny_public_url || ''} onChange={(e) => setField('bunny_public_url', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
            </div>
          </div>

          {/* CDN Delivery & Signing */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold">CDN Delivery &amp; URL Signing (2.4.21)</h3>
              <div className="flex flex-wrap gap-4 text-xs font-semibold">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={Boolean(Number(settings.cdn_enabled))} onChange={() => toggleField('cdn_enabled')} />
                  Enable CDN Delivery
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={Boolean(Number(settings.cdn_signing_enabled))} onChange={() => toggleField('cdn_signing_enabled')} />
                  Enable Signed URLs
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1">CDN Base URL</label>
                <input type="text" value={settings.cdn_base_url || ''} onChange={(e) => setField('cdn_base_url', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">CDN Signing Key</label>
                <input type="password" value={settings.cdn_signing_key || ''} onChange={(e) => setField('cdn_signing_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">CDN Signing TTL (seconds)</label>
                <input type="number" value={settings.cdn_signing_ttl ?? 3600} onChange={(e) => setField('cdn_signing_ttl', Number(e.target.value))} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">CDN Cache-Control Header</label>
                <input type="text" value={settings.cdn_cache_control || ''} onChange={(e) => setField('cdn_cache_control', e.target.value)} placeholder="public, max-age=31536000" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">CDN Purge Webhook URL</label>
                <input type="text" value={settings.cdn_cache_purge_url || ''} onChange={(e) => setField('cdn_cache_purge_url', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">CDN Purge Token</label>
                <input type="password" value={settings.cdn_cache_purge_token || ''} onChange={(e) => setField('cdn_cache_purge_token', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1">CDN Allowed CORS Origins</label>
                <input type="text" value={settings.cdn_cors_origins || ''} onChange={(e) => setField('cdn_cors_origins', e.target.value)} placeholder="*" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1">CDN Custom Media Headers (JSON)</label>
                <textarea
                  rows={3}
                  value={typeof settings.cdn_media_headers === 'object' && settings.cdn_media_headers !== null ? JSON.stringify(settings.cdn_media_headers, null, 2) : (settings.cdn_media_headers || '')}
                  onChange={(e) => setField('cdn_media_headers', e.target.value)}
                  placeholder='{"Access-Control-Allow-Origin": "*"}'
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Default Payment Provider</label>
              <select value={settings.default_payment || 'Stripe'} onChange={(e) => setField('default_payment', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
                <option value="Stripe">Stripe</option>
                <option value="PayPal">PayPal</option>
                <option value="Razorpay">Razorpay</option>
                <option value="Offline">Offline Bank Transfer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Payment Environment Mode</label>
              <select value={settings.payment_mode || 'live'} onChange={(e) => setField('payment_mode', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
                <option value="live">Live Production</option>
                <option value="sandbox">Sandbox / Test</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Stripe Publishable Key</label>
              <input type="text" value={settings.stripe_publishable_key || ''} onChange={(e) => setField('stripe_publishable_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Stripe Secret Key</label>
              <input type="password" value={settings.stripe_secret_key || ''} onChange={(e) => setField('stripe_secret_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">PayPal Client ID</label>
              <input type="text" value={settings.paypal_client_id || ''} onChange={(e) => setField('paypal_client_id', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Razorpay Key ID</label>
              <input type="text" value={settings.razorpay_key_id || ''} onChange={(e) => setField('razorpay_key_id', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Offline Payment Bank Instructions</label>
            <textarea rows={3} value={settings.offline_payment_instructions || ''} onChange={(e) => setField('offline_payment_instructions', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
        </div>
      )}

      {tab === 'ads' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['ad_unit_id_banner', 'AdMob Banner Unit ID'],
              ['ad_unit_id_interstitial', 'AdMob Interstitial Unit ID'],
              ['ad_unit_id_rewarded', 'AdMob Rewarded Unit ID'],
              ['ad_unit_id_native', 'AdMob Native Unit ID'],
              ['unity_game_id', 'Unity Ads Game ID'],
              ['startapp_id', 'StartApp ID'],
              ['applovin_banner_unitid', 'AppLovin Banner Unit ID'],
              ['ironsource_app_key', 'IronSource App Key'],
            ].map(([k, lbl]) => (
              <div key={k}>
                <label className="block text-xs font-semibold mb-1">{lbl}</label>
                <input type="text" value={settings[k] || ''} onChange={(e) => setField(k, e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-5 text-xs pt-2">
            {[
              ['ad_banner', 'AdMob Banner'],
              ['ad_interstitial', 'AdMob Interstitial'],
              ['wach_ads_to_unlock', 'Watch Ads to Unlock Content'],
              ['unityads_banner', 'Unity Banner'],
              ['applovin_banner', 'AppLovin Banner'],
              ['ironsource_banner', 'IronSource Banner'],
            ].map(([k, lbl]) => (
              <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={Boolean(Number(settings[k]))} onChange={() => toggleField(k)} />
                {lbl}
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex flex-wrap gap-5 text-xs">
            {[
              ['vpn', 'Legacy VPN Block'],
              ['vpn_detection_enabled', 'Smart VPN / Proxy Detection'],
              ['vpn_block_playback', 'Block Playback on VPN'],
              ['root_detection', 'Root / Jailbreak Detection'],
              ['flag_secure', 'Block Screenshots (FLAG_SECURE)'],
              ['api_country_restriction_enabled', 'Geo / Country Restriction'],
              ['mobile_signed_requests_enabled', 'Require Signed HMAC Mobile Requests'],
              ['mobile_response_encryption_enabled', 'Encrypt API Payloads'],
            ].map(([k, lbl]) => (
              <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={Boolean(Number(settings[k]))} onChange={() => toggleField(k)} />
                {lbl}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">OneSignal App ID</label>
              <input type="text" value={settings.onesignal_app_id || ''} onChange={(e) => setField('onesignal_app_id', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">OneSignal REST API Key</label>
              <input type="password" value={settings.onesignal_rest_api_key || ''} onChange={(e) => setField('onesignal_rest_api_key', e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={loadGradleProps}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold"
            >
              <FileCode2 className="h-4 w-4 text-indigo-500" /> Generate Android gradle.properties
            </button>
            <button
              type="button"
              onClick={async () => {
                const { data } = await api.post('/admin/settings/access-tokens/cleanup');
                toast.success(data?.message || 'Cleaned expired tokens');
              }}
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-500"
            >
              Cleanup Expired Mobile Sessions
            </button>
          </div>

          {gradleProps && (
            <pre className="rounded-xl bg-slate-950 text-emerald-300 p-4 text-xs font-mono overflow-auto">
              {gradleProps}
            </pre>
          )}
        </div>
      )}

      {tab === 'mail' && (
        <form onSubmit={saveMail} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="SMTP Host" value={mail.mail_host || ''} onChange={(e) => setMail({ ...mail, mail_host: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="number" placeholder="SMTP Port (587)" value={mail.mail_port || 587} onChange={(e) => setMail({ ...mail, mail_port: Number(e.target.value) })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="SMTP Username" value={mail.mail_username || ''} onChange={(e) => setMail({ ...mail, mail_username: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="password" placeholder="SMTP Password" value={mail.mail_password || ''} onChange={(e) => setMail({ ...mail, mail_password: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="email" placeholder="From Address" value={mail.mail_from_address || ''} onChange={(e) => setMail({ ...mail, mail_from_address: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="text" placeholder="From Name" value={mail.mail_from_name || ''} onChange={(e) => setMail({ ...mail, mail_from_name: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">
            Save SMTP Settings
          </button>
        </form>
      )}

      {tab === 'branding' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <ImageInput label="App Logo" value="/api/image/logo" onChange={() => {}} uploadEndpoint="/admin/update/logo" aspect="square" />
            <ImageInput label="Mini Logo" value="/api/image/minilogo" onChange={() => {}} uploadEndpoint="/admin/update/minilogo" aspect="square" />
            <ImageInput label="Splash Image" value={settings.splash_image} onChange={(url) => setField('splash_image', url)} uploadEndpoint="/admin/update/splash" aspect="backdrop" />
            <ImageInput label="Custom Banner" value={settings.custom_banner_image} onChange={(url) => setField('custom_banner_image', url)} uploadEndpoint="/admin/update/customBanner" aspect="backdrop" />
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold">Mobile App Theme Colors</h3>
              <button type="button" onClick={saveColors} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">
                Save Theme Colors
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {colors.map((c, idx) => (
                <div key={c.color_name} className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                  <input
                    type="color"
                    value={c.color_value?.startsWith('#') ? c.color_value.slice(0, 7) : '#6366f1'}
                    onChange={(e) => {
                      const next = [...colors];
                      next[idx] = { ...c, color_value: e.target.value };
                      setColors(next);
                    }}
                    className="h-9 w-9 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{c.color_name}</p>
                    <input
                      type="text"
                      value={c.color_value}
                      onChange={(e) => {
                        const next = [...colors];
                        next[idx] = { ...c, color_value: e.target.value };
                        setColors(next);
                      }}
                      className="w-full text-xs font-mono text-slate-500 bg-transparent focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <h3 className="text-base font-semibold">Database &amp; Cache Maintenance</h3>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={downloadBackup}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <DatabaseBackup className="h-4 w-4" /> Download Database ZIP Backup
            </button>
            <button
              type="button"
              onClick={async () => {
                await api.post('/admin/cacheClear');
                toast.success('Application cache cleared');
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold"
            >
              <Trash className="h-4 w-4 text-rose-500" /> Clear Cache
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
