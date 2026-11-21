import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Server, Shield } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';

export default function ServersDrmPage() {
  const [tab, setTab] = useState('servers');
  const [servers, setServers] = useState([]);
  const [drms, setDrms] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({});
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [sRes, dRes] = await Promise.all([
        api.get('/admin/servers/dataservers'),
        api.get('/admin/drmservers/drmdataservers'),
      ]);
      setServers(sRes.data?.data || sRes.data || []);
      setDrms(dRes.data?.data || dRes.data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (tab === 'servers') {
        if (form.id) await api.put(`/admin/servers/update/${form.id}`, form);
        else await api.post('/admin/servers/store', form);
      } else {
        if (form.id) await api.put(`/admin/drmservers/update/${form.id}`, form);
        else await api.post('/admin/drmservers/store', form);
      }
      toast.success('Saved');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const list = tab === 'servers' ? servers : drms;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Server className="h-6 w-6 text-indigo-500" /> Servers &amp; DRM Keys
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure preset streaming qualities/servers and Widevine/PlayReady/ClearKey DRM endpoints.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm(tab === 'servers' ? { name: '', status: 1 } : { name: '', drmuuid: '', drmlicenceuri: '', status: 1 });
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add {tab === 'servers' ? 'Server' : 'DRM Config'}
        </button>
      </div>

      <div className="flex gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 w-fit text-xs">
        <button type="button" onClick={() => setTab('servers')} className={`rounded-lg px-3.5 py-1.5 font-semibold ${tab === 'servers' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
          Streaming Servers ({servers.length})
        </button>
        <button type="button" onClick={() => setTab('drms')} className={`rounded-lg px-3.5 py-1.5 font-semibold inline-flex items-center gap-1 ${tab === 'drms' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
          <Shield className="h-3.5 w-3.5" /> DRM Servers ({drms.length})
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              {tab === 'drms' && <th className="px-4 py-3">UUID / License URI</th>}
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {list.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No entries yet.</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-semibold">{item.name}</td>
                  {tab === 'drms' && (
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">
                      <p>{item.drmuuid}</p>
                      <p className="truncate max-w-md">{item.drmlicenceuri}</p>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${Number(item.status) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                      {Number(item.status) ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => { setForm({ ...item }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.delete(tab === 'servers' ? `/admin/servers/destroy/${item.id}` : `/admin/drmservers/destroy/${item.id}`);
                        load();
                      }}
                      className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Entry' : 'New Entry'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <input type="text" required placeholder="Name *" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          {tab === 'drms' && (
            <>
              <input type="text" placeholder="DRM UUID" value={form.drmuuid || ''} onChange={(e) => setForm({ ...form, drmuuid: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
              <input type="text" placeholder="DRM License URI" value={form.drmlicenceuri || ''} onChange={(e) => setForm({ ...form, drmlicenceuri: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
            </>
          )}
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={Boolean(Number(form.status ?? 1))} onChange={(e) => setForm({ ...form, status: e.target.checked ? 1 : 0 })} /> Active
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
