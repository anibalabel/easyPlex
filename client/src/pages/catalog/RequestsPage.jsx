import React, { useCallback, useEffect, useState } from 'react';
import { Inbox, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Pagination from '../../components/shared/Pagination';

export default function RequestsPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [listRes, stRes] = await Promise.all([
        api.get('/admin/movie-requests', { params: { page, status: statusFilter } }),
        api.get('/admin/movie-requests/stats'),
      ]);
      setData(listRes.data);
      setStats(stRes.data || {});
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, statusFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id) => {
    await api.post(`/admin/movie-requests/${id}/approve`, { admin_notes: 'Approved via WebPanel' });
    toast.success('Request approved & added to catalog');
    load();
  };

  const reject = async (id) => {
    const reason = window.prompt('Optional rejection note:', '') ?? '';
    await api.post(`/admin/movie-requests/${id}/reject`, { admin_notes: reason });
    toast.success('Request rejected');
    load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete request?')) return;
    await api.delete(`/admin/movie-requests/${id}`);
    load();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Inbox className="h-6 w-6 text-indigo-500" /> Media Requests
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Review viewer title requests; approving creates a catalog record automatically.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Total', stats.total || 0, 'text-slate-900 dark:text-white'],
          ['Pending', stats.pending || 0, 'text-amber-500'],
          ['Approved', stats.approved || 0, 'text-emerald-500'],
          ['Rejected', stats.rejected || 0, 'text-rose-500'],
        ].map(([lbl, val, cls]) => (
          <div key={lbl} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs text-slate-500">{lbl}</p>
            <p className={`text-xl font-bold mt-1 ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 text-xs w-fit">
        {['all', 'pending', 'approved', 'rejected'].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => {
              setPage(1);
              setStatusFilter(st);
            }}
            className={`rounded-lg px-3 py-1.5 font-semibold capitalize ${
              statusFilter === st ? 'bg-indigo-600 text-white' : 'text-slate-500'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Requested Title</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {(data.data || []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-500">No requests matching filter.</td></tr>
            ) : (
              data.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.request_title || r.movie_imdb_id || `#${r.tmdb_id}`}</p>
                    <p className="text-xs text-slate-500">{r.user_notes || r.admin_notes || r.requested_at?.slice(0, 10)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">{r.user_name || r.user_email || `User #${r.user_id}`}</td>
                  <td className="px-4 py-3 text-xs uppercase">{r.type}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                      r.status === 'approved' ? 'bg-emerald-500/15 text-emerald-500' : r.status === 'rejected' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {r.status === 'pending' && (
                      <>
                        <button type="button" onClick={() => approve(r.id)} className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-500/10" title="Approve"><CheckCircle2 className="h-4 w-4" /></button>
                        <button type="button" onClick={() => reject(r.id)} className="rounded-lg p-1.5 text-amber-500 hover:bg-amber-500/10" title="Reject"><XCircle className="h-4 w-4" /></button>
                      </>
                    )}
                    <button type="button" onClick={() => remove(r.id)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 pb-4"><Pagination meta={data} onPageChange={setPage} /></div>
      </div>
    </div>
  );
}
