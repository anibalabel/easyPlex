export const SPA_EXACT_ROUTES = new Set([
  '/',
  '/home',
  '/login',
  '/register',
  '/email/verify',
  '/installer',
  '/admin',
  '/admin/account',
  '/admin/movies',
  '/admin/series',
  '/admin/animes',
  '/admin/mangas',
  '/admin/streaming',
  '/admin/reels',
  '/admin/featured',
  '/admin/top10',
  '/admin/upcoming',
  '/admin/previews',
  '/admin/requests',
  '/admin/video-conversion',
  '/admin/genres',
  '/admin/categories',
  '/admin/collections',
  '/admin/networks',
  '/admin/certifications',
  '/admin/languages',
  '/admin/casters',
  '/admin/servers',
  '/admin/headers',
  '/admin/users',
  '/admin/moderators',
  '/admin/comments',
  '/admin/reports',
  '/admin/suggestions',
  '/admin/plans',
  '/admin/offline-payments',
  '/admin/credits',
  '/admin/ads',
  '/admin/notifications',
  '/admin/settings',
  '/admin/api-explorer',
]);

export function isSpaPageRequest(method, pathname) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (SPA_EXACT_ROUTES.has(pathname)) return true;
  if (pathname.startsWith('/password/reset') || pathname.startsWith('/embed/')) return true;
  return false;
}

export function isStaticAssetPath(pathname) {
  if (pathname.startsWith('/assets/')) return true;
  return /\.(js|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|txt)$/i.test(pathname);
}

export function isBackendPath(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/installer-api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/storage/') ||
    pathname === '/health'
  );
}
