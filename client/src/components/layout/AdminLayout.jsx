import React, { useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Film,
  Tv,
  Sparkles,
  BookOpen,
  Radio,
  Clapperboard,
  Star,
  Trophy,
  CalendarClock,
  Eye,
  Inbox,
  FileVideo,
  Server,
  KeyRound,
  Tags,
  FolderKanban,
  Languages,
  ShieldCheck,
  Layers,
  Globe,
  Users,
  UserCheck,
  Shield,
  MessageSquare,
  CreditCard,
  Receipt,
  Coins,
  Megaphone,
  Flag,
  Lightbulb,
  Bell,
  Settings,
  UserCog,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  Search,
  Wrench,
  Code2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocale, LOCALE_OPTIONS } from '../../contexts/LocaleContext';
import api from '../../lib/api';

const NAV_GROUPS = [
  {
    title: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/admin/account', label: 'Account', icon: UserCog },
    ],
  },
  {
    title: 'Catalog & Streaming',
    items: [
      { to: '/admin/movies', label: 'Movies', icon: Film, perm: 'movies.view' },
      { to: '/admin/series', label: 'Series', icon: Tv, perm: 'series.view' },
      { to: '/admin/animes', label: 'Animes', icon: Sparkles, perm: 'anime.view' },
      { to: '/admin/mangas', label: 'Mangas', icon: BookOpen, perm: 'movies.view' },
      { to: '/admin/streaming', label: 'Live TV', icon: Radio, perm: 'live_streaming.view' },
      { to: '/admin/reels', label: 'Reels', icon: Clapperboard, perm: 'reels.view' },
    ],
  },
  {
    title: 'Curation & Conversion',
    items: [
      { to: '/admin/featured', label: 'Featured', icon: Star, perm: 'featured.view' },
      { to: '/admin/top10', label: 'Top 10', icon: Trophy, perm: 'top10.view' },
      { to: '/admin/upcoming', label: 'Upcoming', icon: CalendarClock, perm: 'upcoming.view' },
      { to: '/admin/previews', label: 'Previews', icon: Eye, perm: 'movies.view' },
      { to: '/admin/requests', label: 'Requests', icon: Inbox, perm: 'movie_requests.view' },
      { to: '/admin/video-conversion', label: 'Video Conversion', icon: FileVideo, perm: 'video_conversion.view' },
    ],
  },
  {
    title: 'Metadata & Servers',
    items: [
      { to: '/admin/genres', label: 'Genres', icon: Tags, perm: 'genres.view' },
      { to: '/admin/categories', label: 'TV Categories', icon: FolderKanban, perm: 'streaming_categories.view' },
      { to: '/admin/casters', label: 'Casters', icon: UserCheck, perm: 'casters.view' },
      { to: '/admin/collections', label: 'Collections', icon: Layers, perm: 'collections.view' },
      { to: '/admin/networks', label: 'Networks', icon: Globe, perm: 'networks.view' },
      { to: '/admin/certifications', label: 'Certifications', icon: ShieldCheck, perm: 'certifications.view' },
      { to: '/admin/languages', label: 'Languages', icon: Languages, perm: 'languages.view' },
      { to: '/admin/servers', label: 'Servers & DRM', icon: Server, perm: 'servers_drm.view' },
      { to: '/admin/headers', label: 'Headers & Agents', icon: KeyRound, perm: 'headers_user_agents.view' },
    ],
  },
  {
    title: 'Community & Users',
    items: [
      { to: '/admin/users', label: 'Users', icon: Users, perm: 'users.view' },
      { to: '/admin/moderators', label: 'Moderators', icon: Shield, adminOnly: true },
      { to: '/admin/comments', label: 'Comments', icon: MessageSquare, perm: 'comments.view' },
      { to: '/admin/reports', label: 'Reports', icon: Flag, perm: 'reports.view' },
      { to: '/admin/suggestions', label: 'Suggestions', icon: Lightbulb, perm: 'suggestions.view' },
    ],
  },
  {
    title: 'Monetization & System',
    items: [
      { to: '/admin/plans', label: 'Plans & Coupons', icon: CreditCard, perm: 'plans.view' },
      { to: '/admin/offline-payments', label: 'Offline Payments', icon: Receipt, perm: 'offline_payments.view' },
      { to: '/admin/credits', label: 'Credits System', icon: Coins, perm: 'credits.view' },
      { to: '/admin/ads', label: 'Ads Manager', icon: Megaphone, perm: 'ads.view' },
      { to: '/admin/notifications', label: 'Notifications', icon: Bell, perm: 'notifications.send' },
      { to: '/admin/settings', label: 'App Settings', icon: Settings, perm: 'settings.view' },
      { to: '/admin/api-explorer', label: 'REST API Explorer', icon: Code2 },
    ],
  },
];

export default function AdminLayout() {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);

  const visibleGroups = useMemo(() => {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.adminOnly) return user?.role === 'admin';
        if (item.perm) return hasPermission(item.perm);
        return true;
      }),
    })).filter((g) => g.items.length > 0);
  }, [user, hasPermission]);

  const handleQuickSearch = async (val) => {
    setQuickQuery(val);
    if (!val.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const { data } = await api.get(`/api/search/${encodeURIComponent(val.trim())}/panel`);
      setSearchResults({
        movies: (data?.movies || []).slice(0, 4),
        series: (data?.series || []).slice(0, 4),
        animes: (data?.animes || []).slice(0, 4),
      });
    } catch {
      setSearchResults(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <Link to="/admin" className="flex items-center gap-3">
          <img src="/favicon.png" alt="EasyPlex" className="h-9 w-9 rounded-xl shadow-md" />
          <div>
            <span className="block text-base font-extrabold tracking-tight text-slate-900 dark:text-white">
              EasyPlex
            </span>
            <span className="inline-flex items-center rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500 dark:text-indigo-400">
              WebPanel v2.4
            </span>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {visibleGroups.map((group) => (
          <div key={group.title}>
            <p className="px-3 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t(group.title)}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t(item.label)}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-2 text-xs">
        <Link
          to="/installer"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium text-slate-500 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Wrench className="h-3.5 w-3.5" />
          {t('Installer')}
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium text-rose-500 hover:bg-rose-500/10"
        >
          <LogOut className="h-3.5 w-3.5" />
          {t('Sign out')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">{sidebarContent}</aside>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 max-w-md">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden rounded-xl border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="relative flex-1">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={quickQuery}
                  onChange={(e) => handleQuickSearch(e.target.value)}
                  onBlur={() => setTimeout(() => setSearchResults(null), 200)}
                  placeholder={t('Quick search movies, series, animes...')}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-9 pr-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                />
                {searchResults && (
                  <div className="absolute left-0 right-0 mt-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2 space-y-1.5 z-50 max-h-80 overflow-y-auto">
                    {searchResults.movies.map((m) => (
                      <button
                        key={`m-${m.id}`}
                        type="button"
                        onMouseDown={() => navigate('/admin/movies')}
                        className="w-full text-left flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span data-no-i18n="true" className="font-medium truncate">{m.title}</span>
                        <span className="text-[10px] font-semibold uppercase text-indigo-500">{t('Movie')}</span>
                      </button>
                    ))}
                    {searchResults.series.map((s) => (
                      <button
                        key={`s-${s.id}`}
                        type="button"
                        onMouseDown={() => navigate('/admin/series')}
                        className="w-full text-left flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span data-no-i18n="true" className="font-medium truncate">{s.name}</span>
                        <span className="text-[10px] font-semibold uppercase text-emerald-500">{t('Series')}</span>
                      </button>
                    ))}
                    {searchResults.animes.map((a) => (
                      <button
                        key={`a-${a.id}`}
                        type="button"
                        onMouseDown={() => navigate('/admin/animes')}
                        className="w-full text-left flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span data-no-i18n="true" className="font-medium truncate">{a.name}</span>
                        <span className="text-[10px] font-semibold uppercase text-amber-500">{t('Anime')}</span>
                      </button>
                    ))}
                    {searchResults.movies.length === 0 &&
                      searchResults.series.length === 0 &&
                      searchResults.animes.length === 0 && (
                        <p className="px-2.5 py-2 text-xs text-slate-400">{t('No catalog matches found.')}</p>
                      )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                data-no-i18n="true"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                aria-label="Language"
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold"
              >
                {LOCALE_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.short} — {l.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-600" />}
              </button>

              <Link
                to="/admin/account"
                className="hidden sm:flex items-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-2 pr-3 py-1 hover:border-indigo-500/40"
              >
                <div className="h-7 w-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold uppercase">
                  {(user?.name || 'A').slice(0, 1)}
                </div>
                <div className="text-left leading-tight">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate max-w-[120px]">
                    {user?.name || 'Admin'}
                  </p>
                  <p className="text-[10px] text-slate-500 uppercase">{user?.role || 'admin'}</p>
                </div>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
