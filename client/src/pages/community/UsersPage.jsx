import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Users, Crown, Ban, CheckCircle, KeyRound, PackagePlus } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';

const emptyUser = () => ({ name: '', email: '', phone: '', password: '', role: 'user', premuim: 0, active: 1 });

export default function UsersPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [plans, setPlans] = useState([]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyUser());
  const [pkgTarget, setPkgTarget] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/users/allusers', { params: { page, q } });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/admin/plans/data').then(({ data: p }) => setPlans(p?.data || p || [])).catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/admin/users/${form.id}`, form);
        toast.success('User updated');
      } else {
        await api.post('/admin/users', form);
        toast.success('User created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleApplyPackage = async (e) => {
    e.preventDefault();
    if (!pkgTarget || !selectedPlanId) return;
    try {
      await api.post(`/admin/users/${pkgTarget.id}/apply-package`, { plan_id: Number(selectedPlanId) });
      toast.success(`Applied package to ${pkgTarget.name}`);
      setPkgTarget(null);
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
            <Users className="h-6 w-6 text-indigo-500" /> Users &amp; Subscribers
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage user accounts, VIP subscriptions, suspensions &amp; password resets.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setForm(emptyUser());
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="Search name, email, phone..."
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data.data || []).length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-500">No users found.</td></tr>
              ) : (
                data.data.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email} {u.phone ? `• ${u.phone}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase font-semibold">{u.role}</td>
                    <td className="px-4 py-3 text-xs">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.patch(`/admin/users/${u.id}/toggle-premium`);
                          load();
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
                          Number(u.premuim) ? 'bg-amber-500/15 text-amber-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                        }`}
                      >
                        <Crown className="h-3 w-3" />
                        {Number(u.premuim) ? u.pack_name || 'VIP Active' : 'Free Tier'}
                      </button>
                      {u.expired_in && <p className="text-[10px] text-slate-400 mt-0.5">Exp: {u.expired_in}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.patch(`/admin/users/${u.id}/toggle-status`);
                          load();
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
                          Number(u.active) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                        }`}
                      >
                        {Number(u.active) ? <CheckCircle className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                        {Number(u.active) ? 'Active' : 'Banned'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPkgTarget(u);
                          setSelectedPlanId(plans[0]?.id ? String(plans[0].id) : '');
                        }}
                        title="Apply Package"
                        className="rounded-lg p-1.5 text-amber-500 hover:bg-amber-500/10"
                      >
                        <PackagePlus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const np = window.prompt(`New password for ${u.email}:`, '');
                          if (!np) return;
                          await api.post(`/admin/users/${u.id}/reset-password`, { password: np });
                          toast.success('Password updated');
                        }}
                        title="Reset Password"
                        className="rounded-lg p-1.5 text-cyan-500 hover:bg-cyan-500/10"
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setForm({ ...emptyUser(), ...u, password: '' });
                          setModalOpen(true);
                        }}
                        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-500/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {u.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Delete user ${u.email}?`)) return;
                            await api.delete(`/admin/users/${u.id}`);
                            load();
                          }}
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4"><Pagination meta={data} onPageChange={setPage} /></div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit User' : 'Create User'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <input type="text" required placeholder="Full Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <input type="email" required placeholder="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <input type="text" placeholder="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <input type="password" required={!form.id} placeholder={form.id ? 'Password (leave blank to keep)' : 'Password *'} value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
          <div className="flex gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={Boolean(Number(form.premuim))} onChange={(e) => setForm({ ...form, premuim: e.target.checked ? 1 : 0 })} /> VIP Premium</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={Boolean(Number(form.active ?? 1))} onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })} /> Active</label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(pkgTarget)} onClose={() => setPkgTarget(null)} title={`Apply Plan to ${pkgTarget?.name}`} size="sm">
        <form onSubmit={handleApplyPackage} className="space-y-4">
          <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.price} {p.currency}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPkgTarget(null)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white">Activate Plan</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
