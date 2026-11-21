import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, KeyRound } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';

export default function HeadersUserAgentsPage() {
  const [tab, setTab] = useState('headers');
  const [headers, setHeaders] = useState([]);
  const [agents, setAgents] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({});
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [hRes, aRes] = await Promise.all([
        api.get('/admin/headers/dataheaders'),
        api.get('/admin/useragents/datausersagent'),
      ]);
      setHeaders(hRes.data?.data || hRes.data || []);
      setAgents(aRes.data?.data || aRes.data || []);
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
      if (tab === 'headers') {
        if (form.id) await api.put(`/admin/headers/update/${form.id}`, form);
        else await api.post('/admin/headers/store', form);
      } else {
        if (form.id) await api.put(`/admin/useragents/update/${form.id}`, form);
        else await api.post('/admin/useragents/store', form);
      }
      toast.success('Saved');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const list = tab === 'headers' ? headers : agents;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-indigo-500" /> HTTP Headers &amp; User Agents
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage reusable Referer/Origin headers and User-Agent presets for player streams.</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm({ name: '' });
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add {tab === 'headers' ? 'Header' : 'User Agent'}
        </button>
      </div>

      <div className="flex gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 w-fit text-xs">
        <button type="button" onClick={() => setTab('headers')} className={`rounded-lg px-3.5 py-1.5 font-semibold ${tab === 'headers' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
          Headers ({headers.length})
        </button>
        <button type="button" onClick={() => setTab('agents')} className={`rounded-lg px-3.5 py-1.5 font-semibold ${tab === 'agents' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
          User Agents ({agents.length})
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {list.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-xs text-slate-500">No entries yet.</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">#{item.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.name}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button type="button" onClick={() => { setForm({ ...item }); setModalOpen(true); }} className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"><Pencil className="h-4 w-4" /></button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.delete(tab === 'headers' ? `/admin/headers/destroy/${item.id}` : `/admin/useragents/destroy/${item.id}`);
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit Value' : 'New Value'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <input type="text" required placeholder={tab === 'headers' ? 'Referer: https://example.com' : 'Mozilla/5.0 ...'} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
