import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Send } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';

export default function NotificationsPage() {
  const [provider, setProvider] = useState('onesignal');
  const [form, setForm] = useState({ title: '', message: '', tmdb: '', type: 'movie', image: '', link: '' });
  const [logs, setLogs] = useState([]);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  const loadLogs = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/notifications/logs');
      setLogs(data?.data || data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleSend = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const url = provider === 'firebase' ? '/admin/notifications/firebase' : '/admin/notifications/onesignal';
      const { data } = await api.post(url, form);
      toast.success(data?.message || 'Push notification logged & sent');
      setForm({ title: '', message: '', tmdb: '', type: 'movie', image: '', link: '' });
      loadLogs();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bell className="h-6 w-6 text-indigo-500" /> Push Notifications
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Dispatch broadcast alerts via OneSignal or Firebase Cloud Messaging (FCM) and inspect notification history.
        </p>
      </div>

      <form onSubmit={handleSend} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-slate-500">Provider:</span>
          {['onesignal', 'firebase'].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold uppercase ${
                provider === p ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {p === 'onesignal' ? 'OneSignal' : 'Firebase FCM'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input type="text" required placeholder="Notification Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
              <option value="movie">Movie</option>
              <option value="serie">Series</option>
              <option value="anime">Anime</option>
              <option value="custom">Custom Link</option>
            </select>
            <input type="text" placeholder="Media ID / TMDB ID" value={form.tmdb} onChange={(e) => setForm({ ...form, tmdb: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>
        </div>

        <textarea rows={3} required placeholder="Notification Body Message *" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input type="url" placeholder="Image / Backdrop URL (optional)" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <input type="url" placeholder="External Action URL (optional)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={sending} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-semibold text-white">
            <Send className="h-4 w-4" /> {sending ? 'Sending...' : 'Send Notification'}
          </button>
        </div>
      </form>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm">Notification Dispatch Log</div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Provider</th>
              <th className="px-4 py-2.5">Title &amp; Message</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {logs.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-500">No push notifications sent yet.</td></tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3 text-xs uppercase font-bold text-indigo-500">{l.provider}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-xs">{l.title}</p>
                    <p className="text-xs text-slate-500">{l.message}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-500 font-semibold">{l.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{l.created_at}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
