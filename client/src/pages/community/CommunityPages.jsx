import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, CheckCircle2, Trash2, ThumbsUp, ThumbsDown, Flag, Lightbulb } from 'lucide-react';
import api, { getErrorMessage } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import Pagination from '../../components/shared/Pagination';

export function CommentsPage() {
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/comments/allcomments', { params: { page } });
      setData(res);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-indigo-500" /> User Comments Moderation
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Approve, react to, or remove comments across movies, series, and episodes.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Author</th>
              <th className="px-4 py-3">Comment</th>
              <th className="px-4 py-3">Reactions</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {(data.data || []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-500">No comments posted yet.</td></tr>
            ) : (
              data.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{c.user_name}</p>
                    <p className="text-[11px] text-slate-500">{c.commentable_type?.replace('App\\', '')} #{c.commentable_id}</p>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-md">{c.comment}</td>
                  <td className="px-4 py-3 text-xs space-x-2">
                    <button type="button" onClick={async () => { await api.post(`/admin/comments/${c.id}/reaction`, { reaction: 'like' }); load(); }} className="inline-flex items-center gap-1 text-emerald-500"><ThumbsUp className="h-3.5 w-3.5" />{c.likes_count || 0}</button>
                    <button type="button" onClick={async () => { await api.post(`/admin/comments/${c.id}/reaction`, { reaction: 'dislike' }); load(); }} className="inline-flex items-center gap-1 text-rose-500"><ThumbsDown className="h-3.5 w-3.5" />{c.dislikes_count || 0}</button>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${Number(c.is_approved) ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                      {Number(c.is_approved) ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {!Number(c.is_approved) && (
                      <button type="button" onClick={async () => { await api.post(`/admin/comments/${c.id}/approve`); load(); }} className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-500/10" title="Approve">
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" onClick={async () => { await api.delete(`/admin/media/delete/comments/${c.id}`); load(); }} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-500/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
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

function FeedbackListPage({ kind }) {
  const isReports = kind === 'reports';
  const Icon = isReports ? Flag : Lightbulb;
  const [items, setItems] = useState([]);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(isReports ? '/admin/reports/data' : '/admin/suggestions/data');
      setItems(data?.data || data || []);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, [isReports, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Icon className={`h-6 w-6 ${isReports ? 'text-rose-500' : 'text-amber-500'}`} />
          {isReports ? 'Broken Stream Reports' : 'User Suggestions'}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isReports ? 'Review viewer reports on broken links or playback issues.' : 'View feature & catalog suggestions submitted from mobile apps.'}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">No items found.</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-semibold">{item.title}</td>
                  <td className="px-4 py-3 text-xs max-w-lg">{item.message}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{item.created_at?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.delete(isReports ? `/admin/reports/destroy/${item.id}` : `/admin/suggestions/destroy/${item.id}`);
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
    </div>
  );
}

export const ReportsPage = () => <FeedbackListPage kind="reports" />;
export const SuggestionsPage = () => <FeedbackListPage kind="suggestions" />;
