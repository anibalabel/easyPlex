export const PERMISSION_DEFINITIONS = {
  dashboard: { label: 'Dashboard', actions: ['view'] },
  movies: { label: 'Movies', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  series: { label: 'Series', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  anime: { label: 'Animes', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  featured: { label: 'Featured', actions: ['view', 'create', 'edit', 'delete'] },
  top10: { label: 'Top10', actions: ['view', 'create', 'edit', 'delete'] },
  video_conversion: { label: 'Video Conversion', actions: ['view', 'create', 'edit', 'delete'] },
  movie_requests: { label: 'Movie Requests', actions: ['view', 'approve', 'reject', 'delete'] },
  live_streaming: { label: 'Streaming', actions: ['view', 'create', 'edit', 'delete'] },
  reels: { label: 'Reels', actions: ['view', 'create', 'edit', 'delete'] },
  upcoming: { label: 'Upcoming', actions: ['view', 'create', 'edit', 'delete'] },
  servers_drm: { label: 'Servers & DRM', actions: ['view', 'create', 'edit', 'delete'] },
  headers_user_agents: { label: 'Headers & User Agents', actions: ['view', 'create', 'edit', 'delete'] },
  streaming_categories: { label: 'Streaming Categories', actions: ['view', 'create', 'edit', 'delete'] },
  genres: { label: 'Genres', actions: ['view', 'create', 'edit', 'delete'] },
  languages: { label: 'Languages', actions: ['view', 'create', 'edit', 'delete'] },
  certifications: { label: 'Certifications', actions: ['view', 'create', 'edit', 'delete'] },
  collections: { label: 'Collections', actions: ['view', 'create', 'edit', 'delete'] },
  networks: { label: 'Networks', actions: ['view', 'create', 'edit', 'delete'] },
  casters: { label: 'Casters', actions: ['view', 'create', 'edit', 'delete'] },
  users: { label: 'Users', actions: ['view', 'create', 'edit', 'delete', 'ban'] },
  subscriptions: { label: 'Subscriptions / Packages', actions: ['view', 'create', 'edit', 'delete'], hidden: true },
  plans: { label: 'Plans & Subscriptions', actions: ['view', 'create', 'edit', 'delete'] },
  credits: { label: 'Credits', actions: ['view', 'create', 'edit', 'delete', 'adjust', 'approve', 'reject'] },
  comments: { label: 'Comments', actions: ['view', 'approve', 'delete'] },
  streaming_servers: { label: 'Streaming Servers', actions: ['view', 'create', 'edit', 'delete'], hidden: true },
  settings: { label: 'Settings', actions: ['view', 'update'] },
  payments: { label: 'Payments', actions: ['view', 'approve', 'reject'], hidden: true },
  reports: { label: 'Reports', actions: ['view', 'delete'] },
  suggestions: { label: 'Suggestions', actions: ['view', 'delete'] },
  notifications: { label: 'Notifications', actions: ['send'] },
  sliders: { label: 'Sliders / Banners', actions: ['view', 'create', 'edit', 'delete'], hidden: true },
  ads: { label: 'Ad Manager', actions: ['view', 'update'] },
  offline_payments: { label: 'Offline Payments', actions: ['view', 'approve', 'reject'] },
  premium_links: { label: 'Premium Links', actions: ['view', 'create', 'edit', 'delete'], hidden: true },
  moderators: { label: 'Moderators', actions: ['view', 'create', 'edit', 'delete', 'permissions'], admin_only: true },
};

export function getAllPermissionsList() {
  const list = [];
  for (const [module, def] of Object.entries(PERMISSION_DEFINITIONS)) {
    for (const action of def.actions) {
      list.push({
        key: `${module}.${action}`,
        module,
        action,
        label: `${def.label}: ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
        hidden: Boolean(def.hidden),
        admin_only: Boolean(def.admin_only),
      });
    }
  }
  return list;
}

export const VISIBLE_PERMISSION_KEYS = getAllPermissionsList()
  .filter((p) => !p.hidden)
  .map((p) => p.key);
