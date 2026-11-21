import React from 'react';

const COLOR_MAP = {
  indigo: 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400 border-indigo-500/25',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
  rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
  cyan: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25',
};

export default function StatCard({ title, value, subtitle, icon: Icon, color = 'indigo', onClick }) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-all ${
        onClick ? 'hover:border-indigo-500/50 hover:shadow-md cursor-pointer' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            {value ?? 0}
          </p>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={`rounded-xl border p-2.5 shrink-0 ${COLOR_MAP[color] || COLOR_MAP.indigo}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Wrapper>
  );
}
