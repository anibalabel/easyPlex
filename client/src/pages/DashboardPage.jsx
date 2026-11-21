import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Film,
  Tv,
  Sparkles,
  Radio,
  Users,
  Eye,
  AlertTriangle,
  Flag,
  CheckCircle2,
  PowerOff,
  Power,
  RefreshCw,
  ArrowUpRight,
  Star,
} from 'lucide-react';
import api, { getErrorMessage, resolveMediaImage } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import StatCard from '../components/shared/StatCard';

export default function DashboardPage() {
  const [counts, setCounts] = useState({});
  const [inactiveCounts, setInactiveCounts] = useState({});
  const [viewsCounts, setViewsCounts] = useState({});
  const [activityStats, setActivityStats] = useState({});
  const [inactiveList, setInactiveList] = useState([]);
  const [topContent, setTopContent] = useState({ movies: [], series: [], animes: [] });
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [topTab, setTopTab] = useState('movies');
  const { toast } = useToast();

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, inRes, vRes, aRes, inListRes, topRes, featRes] = await Promise.all([
        api.get('/admin/moviesCount'),
        api.get('/admin/moviesInactiveCount'),
        api.get('/admin/moviesCountViews'),
        api.get('/admin/activity-statistics'),
        api.get('/admin/inactive-content?limit=25'),
        api.get('/admin/topcontent'),
        api.get('/admin/Allfeatured'),
      ]);
      setCounts(cRes.data?.data?.count || {});
      setInactiveCounts(inRes.data?.data?.count || {});
      setViewsCounts(vRes.data?.data?.count || {});
      setActivityStats(aRes.data || {});
      setInactiveList(inListRes.data?.data || []);
      setTopContent(topRes.data || { movies: [], series: [], animes: [] });
      setFeatured(featRes.data?.data || featRes.data || []);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load dashboard metrics'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleBulkActivate = async (type) => {
    try {
      const { data } = await api.post('/admin/bulk-activate', type ? { type } : {});
      toast.success(data?.message || 'Activated items');
      loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleBulkDeactivate = async (type) => {
    try {
      const { data } = await api.post('/admin/bulk-deactivate', type ? { type } : {});
      toast.success(data?.message || 'Deactivated items');
      loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleToggleItem = async (item) => {
    try {
      await api.post(`/admin/toggle-status/${item.type}/${item.id}`);
      toast.success(`Toggled status for ${item.title}`);
      loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const totalViews =
    Number(viewsCounts.movies || 0) +
    Number(viewsCounts.series || 0) +
    Number(viewsCounts.animes || 0) +
    Number(viewsCounts.livetvs || 0);

  const totalInactive =
    Number(inactiveCounts.movies || 0) +
    Number(inactiveCounts.series || 0) +
    Number(inactiveCounts.animes || 0) +
    Number(inactiveCounts.tvs || 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard Overview</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time catalog metrics, view counts, and content publication controls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => handleBulkActivate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <Power className="h-3.5 w-3.5" /> Activate All
          </button>
          <button
            type="button"
            onClick={() => handleBulkDeactivate()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400"
          >
            <PowerOff className="h-3.5 w-3.5" /> Deactivate All
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Movies"
          value={counts.movies}
          subtitle={`${viewsCounts.movies || 0} views • ${inactiveCounts.movies || 0} inactive`}
          icon={Film}
          color="indigo"
        />
        <StatCard
          title="Series"
          value={counts.series}
          subtitle={`${viewsCounts.series || 0} views • ${inactiveCounts.series || 0} inactive`}
          icon={Tv}
          color="emerald"
        />
        <StatCard
          title="Animes"
          value={counts.animes}
          subtitle={`${viewsCounts.animes || 0} views • ${inactiveCounts.animes || 0} inactive`}
          icon={Sparkles}
          color="amber"
        />
        <StatCard
          title="Live TV Channels"
          value={counts.tvs}
          subtitle={`${viewsCounts.livetvs || 0} views • ${inactiveCounts.tvs || 0} inactive`}
          icon={Radio}
          color="cyan"
        />
        <StatCard
          title="Registered Users"
          value={counts.users}
          subtitle="Active user & subscriber accounts"
          icon={Users}
          color="violet"
        />
        <StatCard
          title="Total Views"
          value={totalViews.toLocaleString()}
          subtitle="Across movies, series, anime & TV"
          icon={Eye}
          color="indigo"
        />
        <StatCard
          title="Inactive Content"
          value={totalInactive}
          subtitle="Unpublished / draft titles"
          icon={AlertTriangle}
          color="amber"
        />
        <StatCard
          title="Open Reports"
          value={counts.reports}
          subtitle="Submitted by viewers"
          icon={Flag}
          color="rose"
        />
      </div>

      {/* Activity Breakdown + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold">Catalog Activity Rate</h2>
            <span className="text-xs text-slate-500">Active vs Inactive ratio per media type</span>
          </div>

          <div className="space-y-4">
            {[
              ['movies', 'Movies', 'bg-indigo-500', '/admin/movies'],
              ['series', 'Series', 'bg-emerald-500', '/admin/series'],
              ['animes', 'Animes', 'bg-amber-500', '/admin/animes'],
              ['livetvs', 'Live TV', 'bg-cyan-500', '/admin/streaming'],
            ].map(([key, label, barColor, linkTo]) => {
              const stat = activityStats[key] || { total: 0, active: 0, inactive: 0, active_percentage: 0 };
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <Link to={linkTo} className="font-semibold hover:text-indigo-500 inline-flex items-center gap-1">
                      {label} <ArrowUpRight className="h-3 w-3" />
                    </Link>
                    <span className="text-slate-500 dark:text-slate-400">
                      <strong className="text-slate-900 dark:text-white">{stat.active}</strong> active / {stat.total} total ({stat.active_percentage}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${stat.active_percentage || 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inactive Content Quick Manager */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Inactive Queue</h2>
            <span className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
              {inactiveList.length} pending
            </span>
          </div>
          {inactiveList.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6 text-slate-400">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">All catalog items are active!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {inactiveList.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{item.title}</p>
                    <p className="text-[10px] uppercase text-slate-500">{item.type}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleItem(item)}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white shrink-0"
                  >
                    Publish
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Content Leaderboard + Featured */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-base font-semibold">Top Viewed Content</h2>
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
              {[
                ['movies', 'Movies'],
                ['series', 'Series'],
                ['animes', 'Animes'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTopTab(k)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    topTab === k ? 'bg-white dark:bg-slate-900 text-indigo-500 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {(topContent[topTab] || []).length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No active {topTab} available yet.</p>
            ) : (
              (topContent[topTab] || []).map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-slate-800/80 p-2.5"
                >
                  <span className="h-7 w-7 rounded-lg bg-indigo-500/10 text-indigo-500 font-bold text-xs flex items-center justify-center shrink-0">
                    #{idx + 1}
                  </span>
                  {item.poster_path ? (
                    <img
                      src={resolveMediaImage(item.poster_path)}
                      alt={item.title || item.name}
                      className="h-11 w-8 rounded object-cover shrink-0 bg-slate-800"
                    />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{item.title || item.name}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-2">
                      <span>{item.genre_name || 'General'}</span>
                      <span className="inline-flex items-center gap-0.5 text-amber-500">
                        <Star className="h-3 w-3 fill-current" />
                        {Number(item.vote_average || 0).toFixed(1)}
                      </span>
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                    {Number(item.views || 0).toLocaleString()} views
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Featured Slider Items</h2>
            <Link to="/admin/featured" className="text-xs font-semibold text-indigo-500 hover:underline">
              Manage Featured →
            </Link>
          </div>
          <div className="space-y-2.5">
            {Array.isArray(featured) && featured.length > 0 ? (
              featured.slice(0, 5).map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-slate-800 p-2.5">
                  {f.poster_path ? (
                    <img
                      src={resolveMediaImage(f.poster_path)}
                      alt={f.title}
                      className="h-11 w-16 rounded-lg object-cover shrink-0 bg-slate-800"
                    />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{f.title}</p>
                    <p className="text-xs text-slate-500 uppercase">{f.type} • Pos #{f.position}</p>
                  </div>
                  {Number(f.premuim) === 1 && (
                    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                      VIP
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">No featured slider entries yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
