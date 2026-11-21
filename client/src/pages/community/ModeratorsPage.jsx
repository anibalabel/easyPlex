import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Shield, History } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';

export default function ModeratorsPage() {
  const [mods, setMods] = useState([]);
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [permGroups, setPermGroups] = useState([]);
  const [audits, setAudits] = useState([]);
  const [auditsOpen, setAuditsOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', user_id: '', permissions: [], active: 1 });
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [mRes, pRes, eRes] = await Promise.all([
        api.get('/admin/moderators/data'),
        api.get('/admin/permissions'),
        api.get('/admin/moderators/eligible-users'),
      ]);
      setMods(mRes.data?.data || mRes.data || []);
      setPermGroups(Array.isArray(pRes.data) ? pRes.data : []);
      setEligibleUsers(eRes.data?.data || eRes.data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const loadAudits = async () => {
    try {
      const { data } = await api.get('/admin/moderators/audits/list');
      setAudits(data || []);
      setAuditsOpen(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const togglePerm = (key) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  };

  const toggleGroup = (group) => {
    const keys = group.permissions.map((p) => p.key);
    const allSelected = keys.every((k) => form.permissions.includes(k));
    setForm((prev) => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter((k) => !keys.includes(k))
        : Array.from(new Set([...prev.permissions, ...keys])),
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/admin/moderators/${form.id}`, form);
        toast.success('Moderator updated');
      } else {
        await api.post('/admin/moderators', form);
        toast.success('Moderator created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-indigo-500" /> Moderators &amp; RBAC Permissions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Delegate granular 135-permission module access and review permission change audits.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAudits}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold"
          >
            <History className="h-4 w-4 text-amber-500" /> Audit Log
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({ name: '', email: '', password: '', user_id: '', permissions: [], active: 1 });
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add Moderator
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Moderator</th>
              <th className="px-4 py-3">Assigned Permissions</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {mods.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No moderators assigned yet.</td></tr>
            ) : (
              mods.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-xs text-slate-500">{m.email}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="rounded-lg bg-indigo-500/15 px-2.5 py-1 font-semibold text-indigo-500">
                      {(m.permissions || []).length} permission(s)
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.patch(`/admin/moderators/${m.id}/status`, { active: !Number(m.active) });
                        load();
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        Number(m.active) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                      }`}
                    >
                      {Number(m.active) ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button
                      type="button"
                      onClick={() => {
                        setForm({ id: m.id, name: m.name, email: m.email, password: '', permissions: m.permissions || [], active: m.active });
                        setModalOpen(true);
                      }}
                      className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Revoke moderator access for ${m.name}?`)) return;
                        await api.delete(`/admin/moderators/${m.id}`);
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? `Edit Moderator: ${form.name}` : 'Assign Moderator'} size="xl">
        <form onSubmit={handleSave} className="space-y-5">
          {!form.id && eligibleUsers.length > 0 && (
            <div>
              <label className="block text-xs font-semibold mb-1">Promote Existing User (or fill new details below)</label>
              <select
                value={form.user_id || ''}
                onChange={(e) => {
                  const u = eligibleUsers.find((x) => String(x.id) === e.target.value);
                  setForm((prev) => ({
                    ...prev,
                    user_id: e.target.value,
                    name: u ? u.name : prev.name,
                    email: u ? u.email : prev.email,
                  }));
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="">-- Create New Moderator Account --</option>
                {eligibleUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="text" required placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="email" required placeholder="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
            <input type="password" placeholder={form.id ? 'New Password (optional)' : 'Password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold">Module Permissions ({form.permissions.length} selected)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[45vh] overflow-y-auto pr-1">
              {permGroups.filter((g) => !g.admin_only).map((group) => (
                <div key={group.module} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-1.5">
                    <span className="text-xs font-bold">{group.label}</span>
                    <button type="button" onClick={() => toggleGroup(group)} className="text-[11px] font-semibold text-indigo-500 hover:underline">
                      Toggle all
                    </button>
                  </div>
                  <div className="space-y-1">
                    {group.permissions.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(p.key)}
                          onChange={() => togglePerm(p.key)}
                        />
                        <span>{p.action}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save Moderator</button>
          </div>
        </form>
      </Modal>

      <Modal open={auditsOpen} onClose={() => setAuditsOpen(false)} title="Permission Audit History" size="xl">
        <div className="space-y-2 max-h-[60vh] overflow-y-auto text-xs">
          {audits.length === 0 ? (
            <p className="text-slate-500">No permission audits logged yet.</p>
          ) : (
            audits.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <p className="font-semibold">
                  {a.actor_name || 'Admin'} updated {a.moderator_name || `User #${a.moderator_id}`}
                </p>
                <p className="text-slate-400 mt-0.5">{a.created_at}</p>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
