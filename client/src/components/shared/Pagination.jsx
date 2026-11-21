import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ meta, onPageChange }) {
  if (!meta) return null;
  const current = Number(meta.current_page || 1);
  const last = Number(meta.last_page || 1);
  const total = Number(meta.total || 0);

  if (last <= 1 && total <= 0) return null;

  const pages = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(last, current + 2);
  for (let i = start; i <= end; i += 1) pages.push(i);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800 text-sm">
      <div className="text-slate-500 dark:text-slate-400">
        {total > 0 ? (
          <span>
            Showing <strong className="text-slate-800 dark:text-slate-200">{meta.from || 1}</strong>–
            <strong className="text-slate-800 dark:text-slate-200">{meta.to || total}</strong> of{' '}
            <strong className="text-slate-800 dark:text-slate-200">{total}</strong>
          </span>
        ) : (
          <span>0 items</span>
        )}
      </div>

      {last > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>

          {start > 1 && (
            <>
              <button
                type="button"
                onClick={() => onPageChange(1)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                1
              </button>
              {start > 2 && <span className="px-1 text-slate-400">…</span>}
            </>
          )}

          {pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                p === current
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {p}
            </button>
          ))}

          {end < last && (
            <>
              {end < last - 1 && <span className="px-1 text-slate-400">…</span>}
              <button
                type="button"
                onClick={() => onPageChange(last)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {last}
              </button>
            </>
          )}

          <button
            type="button"
            disabled={current >= last}
            onClick={() => onPageChange(current + 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
