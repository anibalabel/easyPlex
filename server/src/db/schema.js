import { getDb, isMySql, execute } from './sqlite.js';

async function initMySqlAuxiliarySchema() {
  // Non-destructive: only verify connection & ensure React panel auxiliary tables exist if missing
  await execute(`
    CREATE TABLE IF NOT EXISTS app_colors (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      color_name VARCHAR(191) NOT NULL UNIQUE,
      color_value VARCHAR(191) NOT NULL,
      color_description VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS installer_state (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      installed TINYINT(1) NOT NULL DEFAULT 1,
      installed_at VARCHAR(64) NULL,
      app_name VARCHAR(191) NULL,
      admin_email VARCHAR(191) NULL,
      db_driver VARCHAR(64) DEFAULT 'mysql'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(64) NOT NULL,
      title VARCHAR(255) NULL,
      message TEXT NULL,
      type VARCHAR(64) NULL,
      tmdb VARCHAR(64) NULL,
      image TEXT NULL,
      link TEXT NULL,
      payload LONGTEXT NULL,
      status VARCHAR(64) NOT NULL DEFAULT 'sent',
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS previews (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      backdrop_path TEXT NULL,
      minicover TEXT NULL,
      link TEXT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function initSchema() {
  if (isMySql()) {
    await initMySqlAuxiliarySchema();
    return;
  }

  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL DEFAULT 'user',
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      premuim INTEGER NOT NULL DEFAULT 0,
      verfied INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      email_verified_at TEXT,
      pack_name TEXT,
      pack_id TEXT,
      transaction_id TEXT,
      provider_name TEXT,
      provider_id TEXT,
      type TEXT,
      start_at TEXT,
      expired_in TEXT,
      password TEXT NOT NULL,
      avatar TEXT,
      login_code TEXT UNIQUE,
      remember_token TEXT,
      last_login_at TEXT,
      stripe_id TEXT,
      card_brand TEXT,
      card_last_four TEXT,
      trial_ends_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS moderator_permissions (
      user_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, permission_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS moderator_permission_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      moderator_id INTEGER NOT NULL,
      old_permissions TEXT,
      new_permissions TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar TEXT,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      user_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS avatars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      profile_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      serial_number TEXT,
      model TEXT,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, provider),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS linked_social_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS login_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      user_id INTEGER,
      expires_at TEXT NOT NULL,
      poll_token_hash TEXT,
      claimed_at TEXT,
      tokens_retrieved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mobile_app_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      app_id TEXT NOT NULL,
      device_id_hash TEXT NOT NULL,
      platform TEXT,
      package_name TEXT,
      app_version TEXT,
      signature_hash TEXT,
      refresh_token_hash TEXT UNIQUE,
      refresh_token_expires_at TEXT,
      integrity_verified_at TEXT,
      integrity_expires_at TEXT,
      integrity_verdict TEXT,
      last_seen_at TEXT,
      revoked_at TEXT,
      revoke_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      logo_path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS casts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      cast_id INTEGER,
      original_name TEXT,
      gender INTEGER,
      place_of_birth TEXT,
      profile_path TEXT,
      imdb_id TEXT,
      known_for_department TEXT,
      biography TEXT,
      adult INTEGER NOT NULL DEFAULT 0,
      character TEXT,
      birthday TEXT,
      credit_id TEXT,
      popularity INTEGER,
      "order" INTEGER,
      views INTEGER DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS networks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      logo_path TEXT,
      origin_country TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country_code TEXT,
      certification TEXT,
      meaning TEXT,
      "order" INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS languages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iso_639_1 TEXT NOT NULL UNIQUE,
      english_name TEXT NOT NULL,
      name TEXT,
      logo_path TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      named TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS headers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS embeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      title TEXT NOT NULL,
      imdb_external_id TEXT,
      original_name TEXT,
      subtitle TEXT,
      overview TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      backdrop_path_tv TEXT,
      backgroundvideo TEXT,
      preview_path TEXT,
      vote_average REAL DEFAULT 0,
      trailer_url TEXT,
      vote_count REAL DEFAULT 0,
      popularity REAL DEFAULT 0,
      runtime TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      premuim INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      release_date TEXT,
      skiprecap_start_in INTEGER NOT NULL DEFAULT 0,
      hasrecap INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      enable_stream INTEGER NOT NULL DEFAULT 1,
      enable_media_download INTEGER NOT NULL DEFAULT 1,
      enable_ads_unlock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS movie_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      position INTEGER,
      sort_order INTEGER,
      server TEXT,
      quality TEXT NOT NULL DEFAULT 'Auto',
      header TEXT,
      useragent TEXT,
      link TEXT NOT NULL,
      lang TEXT,
      video_name TEXT,
      hd INTEGER NOT NULL DEFAULT 0,
      embed INTEGER NOT NULL DEFAULT 0,
      is_premium INTEGER NOT NULL DEFAULT 0,
      youtubelink INTEGER NOT NULL DEFAULT 0,
      hls INTEGER NOT NULL DEFAULT 0,
      supported_hosts INTEGER NOT NULL DEFAULT 0,
      downloadonly INTEGER NOT NULL DEFAULT 0,
      drm INTEGER NOT NULL DEFAULT 0,
      drmuuid TEXT,
      drmlicenceuri TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      server TEXT,
      quality TEXT NOT NULL DEFAULT 'Auto',
      header TEXT,
      useragent TEXT,
      video_name TEXT,
      link TEXT NOT NULL,
      is_premium INTEGER NOT NULL DEFAULT 0,
      lang TEXT,
      youtubelink INTEGER NOT NULL DEFAULT 0,
      supported_hosts INTEGER NOT NULL DEFAULT 0,
      external INTEGER NOT NULL DEFAULT 0,
      alldebrid_supported_hosts INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_substitles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      link TEXT NOT NULL,
      lang TEXT,
      type TEXT,
      zip INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      genre_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
      FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_casts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      cast_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
      FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_networks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      network_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
      FOREIGN KEY (network_id) REFERENCES networks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_spoken_languages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      iso_639_1 TEXT,
      movie_id INTEGER NOT NULL,
      language_name TEXT NOT NULL,
      language_code TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      movie_id INTEGER NOT NULL,
      collection_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS movie_certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country_code TEXT,
      certification TEXT,
      meaning TEXT,
      movie_id INTEGER NOT NULL,
      certification_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
      FOREIGN KEY (certification_id) REFERENCES certifications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      imdb_external_id TEXT NOT NULL,
      subtitle TEXT,
      overview TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      backdrop_path_tv TEXT,
      backgroundvideo TEXT,
      trailer_url TEXT,
      preview_path TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      vote_average REAL DEFAULT 0,
      vote_count REAL DEFAULT 0,
      popularity REAL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      newEpisodes INTEGER NOT NULL DEFAULT 0,
      number_of_seasons INTEGER,
      number_of_episodes INTEGER,
      premuim INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      first_air_date TEXT,
      last_air_date TEXT,
      tmdb_last_checked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      serie_id INTEGER NOT NULL,
      season_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      overview TEXT,
      poster_path TEXT,
      air_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      season_id INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      overview TEXT,
      still_path TEXT,
      still_path_tv TEXT,
      vote_average REAL NOT NULL DEFAULT 0,
      vote_count REAL,
      views INTEGER NOT NULL DEFAULT 0,
      air_date TEXT,
      skiprecap_start_in INTEGER NOT NULL DEFAULT 0,
      hasrecap INTEGER NOT NULL DEFAULT 0,
      enable_stream INTEGER NOT NULL DEFAULT 1,
      enable_media_download INTEGER NOT NULL DEFAULT 1,
      enable_ads_unlock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      position INTEGER,
      sort_order INTEGER,
      server TEXT,
      quality TEXT NOT NULL DEFAULT 'Auto',
      header TEXT,
      useragent TEXT,
      link TEXT,
      lang TEXT,
      video_name TEXT,
      embed INTEGER NOT NULL DEFAULT 0,
      is_premium INTEGER NOT NULL DEFAULT 0,
      youtubelink INTEGER NOT NULL DEFAULT 0,
      hls INTEGER NOT NULL DEFAULT 0,
      supported_hosts INTEGER NOT NULL DEFAULT 0,
      drm INTEGER NOT NULL DEFAULT 0,
      drmuuid TEXT,
      drmlicenceuri TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      server TEXT NOT NULL,
      quality TEXT NOT NULL DEFAULT 'Auto',
      header TEXT,
      useragent TEXT,
      link TEXT NOT NULL,
      is_premium INTEGER NOT NULL DEFAULT 0,
      lang TEXT,
      video_name TEXT,
      youtubelink INTEGER NOT NULL DEFAULT 0,
      external INTEGER NOT NULL DEFAULT 0,
      supported_hosts INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_substitles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      name TEXT,
      link TEXT,
      lang TEXT,
      type TEXT,
      zip INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serie_id INTEGER NOT NULL,
      genre_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_casts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serie_id INTEGER NOT NULL,
      cast_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_networks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serie_id INTEGER NOT NULL,
      network_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (network_id) REFERENCES networks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_spoken_languages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      iso_639_1 TEXT,
      serie_id INTEGER NOT NULL,
      language_name TEXT NOT NULL,
      language_code TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      serie_id INTEGER NOT NULL,
      collection_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serie_certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country_code TEXT,
      certification TEXT,
      meaning TEXT,
      serie_id INTEGER NOT NULL,
      certification_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (certification_id) REFERENCES certifications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS animes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      imdb_external_id TEXT NOT NULL,
      overview TEXT,
      subtitle TEXT,
      poster_path TEXT,
      backdrop_path_tv TEXT,
      backgroundvideo TEXT,
      backdrop_path TEXT,
      preview_path TEXT,
      trailer_url TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      vote_average REAL DEFAULT 0,
      vote_count REAL DEFAULT 0,
      popularity REAL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      is_anime INTEGER NOT NULL DEFAULT 1,
      premuim INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      newEpisodes INTEGER NOT NULL DEFAULT 0,
      number_of_seasons INTEGER,
      number_of_episodes INTEGER,
      featured INTEGER NOT NULL DEFAULT 0,
      first_air_date TEXT,
      last_air_date TEXT,
      tmdb_last_checked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS anime_seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      anime_id INTEGER NOT NULL,
      season_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      overview TEXT,
      poster_path TEXT,
      air_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      anime_season_id INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      overview TEXT,
      still_path TEXT,
      still_path_tv TEXT,
      vote_average REAL NOT NULL DEFAULT 0,
      vote_count REAL,
      views INTEGER NOT NULL DEFAULT 0,
      air_date TEXT,
      skiprecap_start_in INTEGER NOT NULL DEFAULT 0,
      hasrecap INTEGER NOT NULL DEFAULT 0,
      enable_stream INTEGER NOT NULL DEFAULT 1,
      enable_media_download INTEGER NOT NULL DEFAULT 1,
      enable_ads_unlock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_season_id) REFERENCES anime_seasons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_episode_id INTEGER NOT NULL,
      position INTEGER,
      sort_order INTEGER,
      server TEXT,
      quality TEXT NOT NULL DEFAULT 'Auto',
      header TEXT,
      useragent TEXT,
      link TEXT NOT NULL,
      lang TEXT,
      video_name TEXT,
      embed INTEGER NOT NULL DEFAULT 0,
      is_premium INTEGER NOT NULL DEFAULT 0,
      youtubelink INTEGER NOT NULL DEFAULT 0,
      hls INTEGER NOT NULL DEFAULT 0,
      supported_hosts INTEGER NOT NULL DEFAULT 0,
      drm INTEGER NOT NULL DEFAULT 0,
      drmuuid TEXT,
      drmlicenceuri TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_episode_id) REFERENCES anime_episodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_episode_id INTEGER NOT NULL,
      server TEXT NOT NULL,
      quality TEXT NOT NULL DEFAULT 'Auto',
      header TEXT,
      useragent TEXT,
      link TEXT NOT NULL,
      is_premium INTEGER NOT NULL DEFAULT 0,
      lang TEXT,
      video_name TEXT,
      youtubelink INTEGER NOT NULL DEFAULT 0,
      external INTEGER NOT NULL DEFAULT 0,
      supported_hosts INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_episode_id) REFERENCES anime_episodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_substitles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_episode_id INTEGER NOT NULL,
      name TEXT,
      link TEXT,
      lang TEXT,
      type TEXT,
      zip INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_episode_id) REFERENCES anime_episodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL,
      genre_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE,
      FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_casts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL,
      cast_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE,
      FOREIGN KEY (cast_id) REFERENCES casts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_networks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL,
      network_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE,
      FOREIGN KEY (network_id) REFERENCES networks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_spoken_languages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      iso_639_1 TEXT,
      anime_id INTEGER NOT NULL,
      language_name TEXT NOT NULL,
      language_code TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      anime_id INTEGER NOT NULL,
      collection_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anime_certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country_code TEXT,
      certification TEXT,
      meaning TEXT,
      anime_id INTEGER NOT NULL,
      certification_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE,
      FOREIGN KEY (certification_id) REFERENCES certifications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mangas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      imdb_external_id TEXT NOT NULL,
      overview TEXT,
      subtitle TEXT,
      poster_path TEXT,
      backdrop_path_tv TEXT,
      backdrop_path TEXT,
      preview_path TEXT,
      trailer_url TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      vote_average REAL DEFAULT 0,
      vote_count REAL DEFAULT 0,
      popularity REAL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      premuim INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      newEpisodes INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      first_air_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS livetvs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      overview TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      backdrop_path_tv TEXT,
      link TEXT,
      link_is_premium INTEGER NOT NULL DEFAULT 0,
      featured INTEGER DEFAULT 0,
      embed INTEGER DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      live INTEGER NOT NULL DEFAULT 1,
      hls INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      vip INTEGER DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS livetv_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      livetv_id INTEGER NOT NULL,
      server TEXT NOT NULL,
      quality TEXT DEFAULT 'Auto',
      link TEXT NOT NULL,
      header TEXT,
      useragent TEXT,
      lang TEXT,
      livetv_name TEXT,
      embed INTEGER NOT NULL DEFAULT 0,
      is_premium INTEGER NOT NULL DEFAULT 0,
      youtubelink INTEGER NOT NULL DEFAULT 0,
      hls INTEGER NOT NULL DEFAULT 0,
      supported_hosts INTEGER NOT NULL DEFAULT 0,
      drm INTEGER NOT NULL DEFAULT 0,
      drmuuid TEXT,
      drmlicenceuri TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (livetv_id) REFERENCES livetvs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS livetv_genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      livetv_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (livetv_id) REFERENCES livetvs(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS featureds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      featured_id INTEGER,
      title TEXT NOT NULL,
      poster_path TEXT,
      release_date TEXT,
      overview TEXT,
      backdrop_path TEXT,
      backdrop_path_tv TEXT,
      backgroundvideo TEXT,
      quality TEXT,
      vote_average REAL,
      type TEXT,
      genre TEXT,
      premuim INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      enable_miniposter INTEGER NOT NULL DEFAULT 0,
      miniposter TEXT,
      custom INTEGER NOT NULL DEFAULT 0,
      custom_link TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS top10s (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      overview TEXT,
      media_id INTEGER,
      poster_path TEXT NOT NULL,
      backdrop_path TEXT,
      backdrop_path_tv TEXT,
      type TEXT NOT NULL,
      genre TEXT,
      vote_average TEXT,
      release_date TEXT,
      quality TEXT,
      backgroundvideo TEXT,
      miniposter TEXT,
      enable_miniposter INTEGER NOT NULL DEFAULT 0,
      premium INTEGER NOT NULL DEFAULT 0,
      custom INTEGER NOT NULL DEFAULT 0,
      custom_link TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS upcomings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      title TEXT NOT NULL,
      overview TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      link TEXT,
      genre TEXT,
      trailer_id TEXT,
      release_date TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS previews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      backdrop_path TEXT,
      minicover TEXT,
      link TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      episode_id INTEGER,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT,
      duration INTEGER NOT NULL DEFAULT 30,
      likes_count INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      position INTEGER,
      created_by INTEGER,
      quality TEXT,
      tags TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS reel_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      liked_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (reel_id, user_id),
      FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reel_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reel_id INTEGER NOT NULL,
      user_id INTEGER,
      viewed_at TEXT NOT NULL,
      watch_time INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER,
      episode_id INTEGER,
      type TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      thumbnail TEXT,
      duration INTEGER,
      file_size INTEGER,
      path TEXT,
      stream_url TEXT,
      cdn_url TEXT,
      storage TEXT DEFAULT 'local',
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS video_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      hls_path TEXT,
      format TEXT NOT NULL DEFAULT 'mp4',
      quality TEXT NOT NULL,
      resolution TEXT,
      bitrate TEXT,
      file_size INTEGER,
      duration INTEGER,
      cdn_url TEXT,
      cloud_url TEXT,
      storage TEXT,
      storage_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS video_processing_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      video_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      selected_qualities TEXT,
      started_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auto_subtitle_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enabled INTEGER NOT NULL DEFAULT 0,
      default_languages TEXT,
      apply_to_bulk_import INTEGER NOT NULL DEFAULT 1,
      apply_to_manual_add INTEGER NOT NULL DEFAULT 1,
      skip_if_exists INTEGER NOT NULL DEFAULT 1,
      max_subtitles_per_language INTEGER NOT NULL DEFAULT 1,
      min_download_count INTEGER NOT NULL DEFAULT 0,
      notify_on_completion INTEGER NOT NULL DEFAULT 0,
      retry_on_failure INTEGER NOT NULL DEFAULT 1,
      retry_attempts INTEGER NOT NULL DEFAULT 2,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS movie_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      movie_imdb_id TEXT,
      tmdb_id INTEGER,
      type TEXT NOT NULL DEFAULT 'movie',
      status TEXT NOT NULL DEFAULT 'pending',
      request_title TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      release_date TEXT,
      vote_average REAL,
      tmdb_payload TEXT,
      user_notes TEXT,
      admin_notes TEXT,
      requested_at TEXT NOT NULL,
      processed_at TEXT,
      processed_by INTEGER,
      created_media_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commentable_type TEXT NOT NULL,
      commentable_id INTEGER NOT NULL,
      user_image TEXT,
      user_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      is_approved INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER,
      likes_count INTEGER NOT NULL DEFAULT 0,
      dislikes_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comment_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (comment_id, user_id),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      favoriteable_type TEXT NOT NULL,
      favoriteable_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, favoriteable_id, favoriteable_type)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      media_type TEXT,
      media_id INTEGER,
      rating REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, media_type, media_id)
    );

    CREATE TABLE IF NOT EXISTS resumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_resume_id INTEGER NOT NULL,
      tmdb TEXT,
      resumeWindow INTEGER,
      resumePosition INTEGER,
      movieDuration INTEGER,
      deviceId INTEGER,
      profileId INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS watch_histories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      profile_id INTEGER,
      device_id TEXT,
      watchable_type TEXT NOT NULL,
      watchable_id INTEGER NOT NULL,
      episode_id INTEGER,
      current_position INTEGER NOT NULL DEFAULT 0,
      duration INTEGER NOT NULL DEFAULT 0,
      progress_percentage REAL NOT NULL DEFAULT 0,
      last_watched_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT,
      description TEXT,
      features TEXT,
      max_devices INTEGER NOT NULL DEFAULT 1,
      max_profiles INTEGER NOT NULL DEFAULT 1,
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      trial_days INTEGER NOT NULL DEFAULT 0,
      price TEXT NOT NULL DEFAULT '0',
      stripe_plan_id TEXT NOT NULL DEFAULT '',
      stripe_price_id TEXT NOT NULL DEFAULT '',
      stripe_product_id TEXT,
      paypal_plan_id TEXT,
      razorpay_plan_id TEXT,
      pack_duration TEXT NOT NULL DEFAULT '1',
      currency_plan_app TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      interval TEXT NOT NULL DEFAULT 'month',
      interval_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'stripe',
      provider_id TEXT,
      provider_status TEXT,
      provider_plan_id TEXT,
      stripe_id TEXT NOT NULL,
      stripe_status TEXT NOT NULL,
      stripe_plan TEXT,
      quantity INTEGER,
      trial_ends_at TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      ends_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_payment_method_id TEXT,
      type TEXT NOT NULL DEFAULT 'card',
      last_four TEXT,
      brand TEXT,
      exp_month TEXT,
      exp_year TEXT,
      holder_name TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS offline_payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      note TEXT,
      proof_image TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      reviewed_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pix_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'mercadopago',
      provider_payment_id TEXT,
      reference TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      pix_code TEXT,
      qr_code_image TEXT,
      expires_at TEXT,
      paid_at TEXT,
      raw_response TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promocodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      code TEXT NOT NULL UNIQUE,
      usages_left INTEGER NOT NULL DEFAULT 1,
      bound_to_user INTEGER NOT NULL DEFAULT 0,
      multi_use INTEGER NOT NULL DEFAULT 0,
      details TEXT,
      expired_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS promocode_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promocode_id INTEGER NOT NULL,
      user_id INTEGER,
      session_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (promocode_id) REFERENCES promocodes(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      balance INTEGER NOT NULL DEFAULT 0,
      total_purchased INTEGER NOT NULL DEFAULT 0,
      total_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      credits_amount INTEGER NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'enabled',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      credits_amount INTEGER NOT NULL,
      balance_before INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      payment_method TEXT,
      payment_reference TEXT UNIQUE,
      content_type TEXT,
      content_id INTEGER,
      description TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_credit_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      credits_required INTEGER NOT NULL DEFAULT 1,
      is_credit_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (content_type, content_id)
    );

    CREATE TABLE IF NOT EXISTS user_content_unlocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      credits_spent INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'consumed',
      unlocked_at TEXT,
      consumed_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, content_type, content_id)
    );

    CREATE TABLE IF NOT EXISTS credit_purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credit_package_id INTEGER NOT NULL,
      credits_amount INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      note TEXT,
      proof_image TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      reviewed_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      link TEXT,
      clickThroughUrl TEXT,
      customVast INTEGER NOT NULL DEFAULT 0,
      duration TEXT,
      skipoffset TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS statistics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installs INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      color_name TEXT NOT NULL UNIQUE,
      color_value TEXT NOT NULL,
      color_description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS branding_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      toolbar_logo TEXT NOT NULL DEFAULT 'app_logo',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mail_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mail_driver TEXT DEFAULT 'smtp',
      mail_host TEXT,
      mail_port INTEGER DEFAULT 587,
      mail_username TEXT,
      mail_password TEXT,
      mail_encryption TEXT,
      mail_from_address TEXT,
      mail_from_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      title TEXT,
      message TEXT,
      type TEXT,
      tmdb TEXT,
      image TEXT,
      link TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS installer_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installed INTEGER NOT NULL DEFAULT 1,
      installed_at TEXT,
      app_name TEXT,
      admin_email TEXT,
      db_driver TEXT DEFAULT 'sqlite'
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_name TEXT NOT NULL DEFAULT 'EASYPLEX',
      authorization TEXT DEFAULT '',
      tmdb_api_key TEXT DEFAULT '',
      purchase_key TEXT DEFAULT '',
      activated_domain TEXT,
      license_activated_at TEXT,
      license_last_verified_at TEXT,
      license_activation_valid INTEGER NOT NULL DEFAULT 1,
      runtime_installation_secret TEXT,
      tmdb_lang TEXT NOT NULL DEFAULT '{"english_name":"English","iso_639_1":"en","name":"English"}',
      app_url_android TEXT DEFAULT '',
      autosubstitles INTEGER NOT NULL DEFAULT 1,
      livetv INTEGER NOT NULL DEFAULT 1,
      ads_player INTEGER NOT NULL DEFAULT 1,
      vast_ad_roll_type TEXT NOT NULL DEFAULT 'preroll',
      vast_midroll_time_seconds INTEGER NOT NULL DEFAULT 60,
      anime INTEGER NOT NULL DEFAULT 1,
      facebook_show_interstitial INTEGER NOT NULL DEFAULT 0,
      ad_show_interstitial INTEGER NOT NULL DEFAULT 0,
      ad_interstitial INTEGER NOT NULL DEFAULT 0,
      ad_unit_id_interstitial TEXT DEFAULT '',
      ad_banner INTEGER NOT NULL DEFAULT 0,
      ad_unit_id_banner TEXT DEFAULT '',
      ad_face_audience_interstitial INTEGER NOT NULL DEFAULT 0,
      ad_face_audience_banner INTEGER NOT NULL DEFAULT 0,
      ad_unit_id_facebook_interstitial_audience TEXT DEFAULT '',
      ad_unit_id_facebook_banner_audience TEXT DEFAULT '',
      privacy_policy TEXT DEFAULT '',
      latestVersion TEXT DEFAULT '',
      update_title TEXT DEFAULT '',
      releaseNotes TEXT DEFAULT '',
      enable_custom_message INTEGER NOT NULL DEFAULT 0,
      custom_message TEXT DEFAULT '',
      url TEXT DEFAULT '',
      imdb_cover_path TEXT DEFAULT 'http://image.tmdb.org/t/p/w500',
      paypal_client_id TEXT DEFAULT '',
      paypal_secret TEXT DEFAULT '',
      paypal_amount TEXT DEFAULT '',
      stripe_publishable_key TEXT DEFAULT '',
      stripe_secret_key TEXT DEFAULT '',
      razorpay_key_id TEXT DEFAULT '',
      razorpay_key_secret TEXT DEFAULT '',
      razorpay_webhook_secret TEXT DEFAULT '',
      featured_home_numbers INTEGER NOT NULL DEFAULT 5,
      startapp_id TEXT DEFAULT '',
      ad_unit_id_rewarded TEXT DEFAULT '',
      ad_unit_id__facebook_rewarded TEXT DEFAULT '',
      ad_unit_id__appodeal_rewarded TEXT,
      unity_game_id TEXT DEFAULT '',
      default_network TEXT DEFAULT '',
      wach_ads_to_unlock INTEGER NOT NULL DEFAULT 0,
      aws_s3_storage INTEGER NOT NULL DEFAULT 0,
      aws_access_key_id TEXT,
      aws_secret_access_key TEXT,
      aws_default_region TEXT,
      aws_bucket TEXT,
      wasabi_storage INTEGER NOT NULL DEFAULT 0,
      wasabi_access_key_id TEXT,
      wasabi_secret_access_key TEXT,
      wasabi_default_region TEXT,
      wasabi_bucket TEXT,
      default_media_placeholder_path TEXT DEFAULT '',
      next_episode_timer INTEGER NOT NULL DEFAULT 15,
      auto_play_next_media INTEGER NOT NULL DEFAULT 1,
      facebook_url TEXT DEFAULT 'http://facebook.com',
      twitter_url TEXT DEFAULT 'http://twitter.com',
      instagram_url TEXT DEFAULT 'http://instagram.com',
      telegram_url TEXT DEFAULT 'http://telegram.com',
      ad_unit_id_native TEXT DEFAULT '',
      default_payment TEXT DEFAULT 'Stripe',
      payment_mode TEXT NOT NULL DEFAULT 'live',
      offline_payment_instructions TEXT,
      pix_provider TEXT NOT NULL DEFAULT 'mercadopago',
      pix_access_token TEXT,
      paypal_currency TEXT DEFAULT '',
      appodeal_show_interstitial INTEGER NOT NULL DEFAULT 0,
      ad_unit_id_native_enable INTEGER NOT NULL DEFAULT 0,
      appodeal_banner INTEGER NOT NULL DEFAULT 0,
      appodeal_interstitial INTEGER NOT NULL DEFAULT 0,
      server_dialog_selection INTEGER NOT NULL DEFAULT 0,
      download_premuim_only INTEGER NOT NULL DEFAULT 0,
      default_network_player TEXT DEFAULT '',
      wach_ads_to_unlock_player INTEGER NOT NULL DEFAULT 0,
      enable_custom_banner INTEGER NOT NULL DEFAULT 0,
      custom_banner_image TEXT DEFAULT '',
      custom_banner_image_link TEXT DEFAULT '',
      default_downloads_options TEXT,
      mantenance_mode_message TEXT DEFAULT '',
      splash_image TEXT DEFAULT '',
      default_youtube_quality TEXT DEFAULT '',
      mantenance_mode INTEGER NOT NULL DEFAULT 0,
      allow_adm INTEGER NOT NULL DEFAULT 0,
      enable_previews INTEGER NOT NULL DEFAULT 0,
      enable_pinned INTEGER NOT NULL DEFAULT 0,
      startapp_banner INTEGER NOT NULL DEFAULT 0,
      startapp_interstitial INTEGER NOT NULL DEFAULT 0,
      enable_vlc INTEGER NOT NULL DEFAULT 0,
      resume_offline INTEGER NOT NULL DEFAULT 1,
      pip_enable INTEGER NOT NULL DEFAULT 1,
      user_agent TEXT DEFAULT 'EasyPlex',
      unityads_banner INTEGER NOT NULL DEFAULT 0,
      unityads_interstitial INTEGER NOT NULL DEFAULT 0,
      streaming INTEGER NOT NULL DEFAULT 1,
      enable_banner_bottom INTEGER NOT NULL DEFAULT 0,
      ad_face_audience_native INTEGER NOT NULL DEFAULT 0,
      enable_upcoming INTEGER NOT NULL DEFAULT 1,
      ad_unit_id_facebook_native_audience TEXT DEFAULT '',
      app_packagename TEXT DEFAULT 'com.easyplexdemoapp',
      allowed_apk_signatures TEXT,
      enable_download INTEGER NOT NULL DEFAULT 1,
      notification_separated INTEGER NOT NULL DEFAULT 0,
      default_cast_option TEXT DEFAULT 'INTERNAL',
      default_trailer_default TEXT DEFAULT 'Youtube',
      email_verify INTEGER NOT NULL DEFAULT 0,
      force_login INTEGER NOT NULL DEFAULT 0,
      favoriteonline INTEGER NOT NULL DEFAULT 1,
      separate_download INTEGER NOT NULL DEFAULT 0,
      vpn INTEGER NOT NULL DEFAULT 0,
      notification_style INTEGER NOT NULL DEFAULT 0,
      force_update INTEGER NOT NULL DEFAULT 0,
      appnext_banner INTEGER NOT NULL DEFAULT 0,
      appnext_interstitial INTEGER NOT NULL DEFAULT 0,
      appnext_placementid TEXT,
      livetv_multi_servers INTEGER NOT NULL DEFAULT 0,
      suggest_auth INTEGER NOT NULL DEFAULT 0,
      networks INTEGER NOT NULL DEFAULT 0,
      enable_webview INTEGER NOT NULL DEFAULT 0,
      webview_link TEXT,
      vungle_banner INTEGER NOT NULL DEFAULT 0,
      vungle_interstitial INTEGER NOT NULL DEFAULT 0,
      vungle_appid TEXT,
      vungle_interstitial_placement_name TEXT,
      vungle_banner_placement_name TEXT,
      vungle_reward_placement_name TEXT,
      flag_secure INTEGER NOT NULL DEFAULT 0,
      appnext_interstitial_show INTEGER NOT NULL DEFAULT 0,
      ironsource_banner INTEGER NOT NULL DEFAULT 0,
      ironsource_interstitial INTEGER NOT NULL DEFAULT 0,
      ironsource_app_key TEXT,
      ironsource_interstitial_placement_name TEXT,
      ironsource_banner_placement_name TEXT,
      ironsource_reward_placement_name TEXT,
      unity_show INTEGER NOT NULL DEFAULT 0,
      root_detection INTEGER NOT NULL DEFAULT 0,
      applovin_banner INTEGER NOT NULL DEFAULT 0,
      applovin_interstitial INTEGER NOT NULL DEFAULT 0,
      applovin_banner_unitid TEXT,
      applovin_interstitial_unitid TEXT,
      applovin_reward_unitid TEXT,
      applovin_interstitial_show INTEGER NOT NULL DEFAULT 0,
      vungle_interstitial_show INTEGER NOT NULL DEFAULT 0,
      ironsource_interstitial_show INTEGER NOT NULL DEFAULT 0,
      unity_banner_placement_id TEXT DEFAULT 'banner',
      unity_interstitial_placement_id TEXT DEFAULT 'inter',
      unity_reward_placement_id TEXT DEFAULT 'rewardedVideo',
      reset_password_message TEXT DEFAULT 'message',
      force_password_access INTEGER NOT NULL DEFAULT 0,
      force_inappupdate INTEGER NOT NULL DEFAULT 0,
      password TEXT,
      app_password_sha256 TEXT,
      default_layout_networks TEXT DEFAULT 'Layout1',
      episode_card_layout TEXT DEFAULT 'compact',
      default_substitle_option TEXT DEFAULT 'Opensubs',
      enable_comments INTEGER NOT NULL DEFAULT 0,
      applovin_native INTEGER NOT NULL DEFAULT 0,
      applovin_native_unitid TEXT,
      discover_style TEXT DEFAULT '0',
      library_style TEXT DEFAULT '0',
      webpanelversion TEXT DEFAULT '2.4',
      phone_verification INTEGER NOT NULL DEFAULT 0,
      profile_selection INTEGER NOT NULL DEFAULT 0,
      device_management INTEGER NOT NULL DEFAULT 0,
      enable_player_inter INTEGER NOT NULL DEFAULT 0,
      internallangs INTEGER NOT NULL DEFAULT 0,
      searchhistory INTEGER NOT NULL DEFAULT 0,
      forcewatchbyauth INTEGER NOT NULL DEFAULT 0,
      safemode INTEGER NOT NULL DEFAULT 0,
      enable_watchinyourlang INTEGER NOT NULL DEFAULT 0,
      rtl_support INTEGER NOT NULL DEFAULT 1,
      wortise_interstitial INTEGER NOT NULL DEFAULT 0,
      wortise_banner INTEGER NOT NULL DEFAULT 0,
      wortise_appid TEXT,
      wortise_placement_unitid TEXT,
      wortise_interstitial_show INTEGER NOT NULL DEFAULT 0,
      wortise_banner_enable INTEGER NOT NULL DEFAULT 0,
      wortise_banner_unitid TEXT,
      wortise_reward_unitid TEXT,
      enablelangsinservers INTEGER NOT NULL DEFAULT 0,
      enablesociallogins INTEGER NOT NULL DEFAULT 0,
      enabledynamicslider INTEGER NOT NULL DEFAULT 0,
      slidertimer INTEGER NOT NULL DEFAULT 5,
      device_management_limit INTEGER NOT NULL DEFAULT 5,
      profile_selection_limit INTEGER NOT NULL DEFAULT 5,
      enablelayoutchange INTEGER NOT NULL DEFAULT 0,
      enableshadow INTEGER NOT NULL DEFAULT 1,
      enablecustomcontent INTEGER NOT NULL DEFAULT 0,
      home_content_order TEXT,
      top10_mode TEXT DEFAULT 'manual',
      top10_auto_criteria TEXT DEFAULT 'views',
      top10_auto_window TEXT DEFAULT 'all',
      top10_auto_types TEXT,
      rv_content TEXT,
      rv_content_network TEXT,
      rv_content_lang TEXT,
      disablelogin INTEGER NOT NULL DEFAULT 0,
      enable_collections INTEGER NOT NULL DEFAULT 0,
      backgroundvideo INTEGER NOT NULL DEFAULT 0,
      firebasejson TEXT,
      googleapiurl TEXT,
      m3uplaylistpath TEXT,
      m3uplaylist INTEGER NOT NULL DEFAULT 0,
      playlistauth INTEGER NOT NULL DEFAULT 0,
      notification_counter INTEGER NOT NULL DEFAULT 0,
      video_quality_profiles TEXT,
      video_quality_presets TEXT,
      ffmpeg INTEGER NOT NULL DEFAULT 1,
      ffmpeg_binaries TEXT DEFAULT 'ffmpeg',
      ffprobe_binaries TEXT DEFAULT 'ffprobe',
      premium_users_bypass_credits INTEGER NOT NULL DEFAULT 0,
      credit_unlock_policy TEXT NOT NULL DEFAULT 'forever',
      credits_system_enabled INTEGER NOT NULL DEFAULT 0,
      default_notification TEXT,
      onesignal_app_id TEXT,
      onesignal_rest_api_key TEXT,
      included_segments TEXT,
      reels INTEGER NOT NULL DEFAULT 0,
      reels_ad_frequency INTEGER NOT NULL DEFAULT 5,
      auto_advance_reels INTEGER NOT NULL DEFAULT 0,
      reel_auto_advance_delay INTEGER NOT NULL DEFAULT 3,
      usercanadd INTEGER NOT NULL DEFAULT 0,
      enable_jwt_token INTEGER NOT NULL DEFAULT 0,
      inject_embed INTEGER NOT NULL DEFAULT 0,
      enable_shadows INTEGER NOT NULL DEFAULT 1,
      default_media_placeholder_path_home TEXT,
      vpn_detection_enabled INTEGER NOT NULL DEFAULT 0,
      vpn_block_playback INTEGER NOT NULL DEFAULT 1,
      vpn_block_api_calls INTEGER NOT NULL DEFAULT 0,
      vpn_show_warning INTEGER NOT NULL DEFAULT 1,
      vpn_block_medium_risk INTEGER NOT NULL DEFAULT 0,
      vpn_check_backend INTEGER NOT NULL DEFAULT 1,
      vpn_medium_risk_score INTEGER NOT NULL DEFAULT 40,
      vpn_high_risk_score INTEGER NOT NULL DEFAULT 70,
      vpn_package_names TEXT,
      api_country_restriction_enabled INTEGER NOT NULL DEFAULT 0,
      api_country_restriction_mode TEXT NOT NULL DEFAULT 'allow_selected',
      api_country_restriction_countries TEXT,
      api_country_restriction_unknown_policy TEXT NOT NULL DEFAULT 'allow',
      api_country_restriction_message TEXT NOT NULL DEFAULT 'This app is not available in your country.',
      default_native_network TEXT NOT NULL DEFAULT 'admob',
      ironsource_native INTEGER NOT NULL DEFAULT 0,
      ironsource_native_placement_name TEXT,
      library_native_ads INTEGER NOT NULL DEFAULT 0,
      library_native_ads_interval INTEGER NOT NULL DEFAULT 6,
      api_rate_limit_per_minute INTEGER NOT NULL DEFAULT 300,
      app_security_hash INTEGER NOT NULL DEFAULT 0,
      app_security_sha256 INTEGER NOT NULL DEFAULT 0,
      app_security_auth INTEGER NOT NULL DEFAULT 0,
      mobile_app_id TEXT DEFAULT 'easyplex-mobile',
      mobile_app_hmac_secret TEXT,
      mobile_signed_requests_enabled INTEGER NOT NULL DEFAULT 0,
      mobile_signature_tolerance_seconds INTEGER NOT NULL DEFAULT 60,
      mobile_signature_nonce_ttl_seconds INTEGER NOT NULL DEFAULT 120,
      mobile_response_encryption_enabled INTEGER NOT NULL DEFAULT 0,
      mobile_response_encryption_mode TEXT DEFAULT 'header',
      mobile_response_encryption_secret TEXT,
      mobile_response_encrypt_errors INTEGER NOT NULL DEFAULT 0,
      mobile_jwt_binding_enabled INTEGER NOT NULL DEFAULT 0,
      mobile_jwt_binding_require_payload INTEGER NOT NULL DEFAULT 0,
      mobile_app_integrity_enabled INTEGER NOT NULL DEFAULT 0,
      mobile_app_integrity_required INTEGER NOT NULL DEFAULT 0,
      play_integrity_enabled INTEGER NOT NULL DEFAULT 0,
      mobile_block_sniffer_apps INTEGER NOT NULL DEFAULT 0,
      sniffer_app_package_names TEXT,
      mobile_certificate_pins TEXT,
      vpn_check_enabled INTEGER NOT NULL DEFAULT 1,
      vpn_check_provider TEXT DEFAULT 'local',
      vpn_check_provider_url TEXT DEFAULT 'https://ipwho.is/{ip}?security=1',
      vpn_check_provider_key TEXT,
      vpn_check_cache_minutes INTEGER NOT NULL DEFAULT 10,
      vpn_check_block_hosting INTEGER NOT NULL DEFAULT 1,
      vpn_check_block_tor INTEGER NOT NULL DEFAULT 1,
      vpn_check_block_proxy INTEGER NOT NULL DEFAULT 1,
      vpn_check_block_vpn INTEGER NOT NULL DEFAULT 1,
      vpn_check_fail_closed INTEGER NOT NULL DEFAULT 0,
      frontend_base_url TEXT,
      jwt_secret TEXT,
      jwt_time_expiration INTEGER NOT NULL DEFAULT 86400,
      jwt_ttl INTEGER NOT NULL DEFAULT 1440,
      jwt_refresh_ttl INTEGER NOT NULL DEFAULT 20160,
      jwt_algo TEXT NOT NULL DEFAULT 'HS256',
      jwt_leeway INTEGER NOT NULL DEFAULT 2,
      jwt_blacklist_enabled INTEGER NOT NULL DEFAULT 1,
      jwt_blacklist_grace_period INTEGER NOT NULL DEFAULT 0,
      jwt_timestamp_tolerance INTEGER NOT NULL DEFAULT 31536000,
      api_key TEXT,
      response_cache_enabled INTEGER NOT NULL DEFAULT 1,
      response_cache_lifetime INTEGER NOT NULL DEFAULT 604800,
      verify_email_subject TEXT DEFAULT 'Verify Your Email Address',
      verify_email_greeting TEXT DEFAULT 'Hello!',
      verify_email_line_1 TEXT DEFAULT 'Please verify your email address to complete your registration.',
      verify_email_user_id_text TEXT DEFAULT 'Your User ID: :userId',
      verify_email_token_text TEXT DEFAULT 'Your Verification Token:',
      verify_email_instructions TEXT DEFAULT 'Enter these details in the app to verify your account.',
      verify_email_expiry TEXT DEFAULT 'This verification token will expire in 60 minutes.',
      verify_email_disclaimer TEXT DEFAULT 'If you did not create an account, no further action is required.',
      google_client_id TEXT,
      google_client_secret TEXT,
      google_redirect_uri TEXT,
      facebook_client_id TEXT,
      facebook_client_secret TEXT,
      youtube_api_key TEXT,
      opensubtitles_user_agent TEXT DEFAULT 'TemporaryUserAgent',
      upload_max_kb INTEGER NOT NULL DEFAULT 4194304,
      limit_upcoming INTEGER NOT NULL DEFAULT 10,
      limit_networks INTEGER NOT NULL DEFAULT 10,
      limit_collections INTEGER NOT NULL DEFAULT 10,
      limit_streaming INTEGER NOT NULL DEFAULT 10,
      limit_casts INTEGER NOT NULL DEFAULT 10,
      limit_latest INTEGER NOT NULL DEFAULT 10,
      limit_popular_series INTEGER NOT NULL DEFAULT 20,
      limit_recent_movies INTEGER NOT NULL DEFAULT 15,
      limit_recent_series INTEGER NOT NULL DEFAULT 10,
      limit_popular INTEGER NOT NULL DEFAULT 10,
      limit_latest_episodes_series INTEGER NOT NULL DEFAULT 20,
      limit_latest_episodes_animes INTEGER NOT NULL DEFAULT 20,
      limit_rv_content INTEGER NOT NULL DEFAULT 15,
      limit_rv_content_network INTEGER NOT NULL DEFAULT 15,
      limit_rv_content_lang INTEGER NOT NULL DEFAULT 15,
      limit_animes_latest INTEGER NOT NULL DEFAULT 10,
      limit_choosed INTEGER NOT NULL DEFAULT 10,
      limit_featured INTEGER NOT NULL DEFAULT 10,
      limit_pinned INTEGER NOT NULL DEFAULT 10,
      limit_recommended INTEGER NOT NULL DEFAULT 10,
      limit_thisweek INTEGER NOT NULL DEFAULT 10,
      limit_top10 INTEGER NOT NULL DEFAULT 10,
      limit_trending INTEGER NOT NULL DEFAULT 10,
      debugbar_enabled INTEGER NOT NULL DEFAULT 0,
      app_language TEXT NOT NULL DEFAULT 'en',
      api_country_provider_cache_hours INTEGER NOT NULL DEFAULT 24,
      api_country_provider_url TEXT DEFAULT 'https://ipwho.is/{ip}',
      api_country_provider_key TEXT,
      app_log TEXT DEFAULT 'stack',
      cashier_currency TEXT NOT NULL DEFAULT 'usd',
      cashier_logger TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, media_id)
    );
  `);

  // Safe non-destructive SQLite column upgrades for 2.4.21 alignment
  const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!userCols.has('verified')) db.exec('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');

  const settingCols = new Set(db.prepare('PRAGMA table_info(settings)').all().map((c) => c.name));
  const extra2421Settings = [
    ['easyplex_24_upgrade_token', 'TEXT'],
    ['easyplex_24_upgrade_sql_path', 'TEXT'],
    ['easyplex_24_dump_path', 'TEXT'],
    ['telescope_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['vidsrc', 'INTEGER NOT NULL DEFAULT 0'],
    ['vidsrc_endpoint', 'TEXT'],
    ['default_embed', 'TEXT'],
    ['r2_storage', 'INTEGER NOT NULL DEFAULT 0'],
    ['r2_access_key_id', 'TEXT'],
    ['r2_secret_access_key', 'TEXT'],
    ['r2_bucket', 'TEXT'],
    ['r2_endpoint', 'TEXT'],
    ['r2_public_url', 'TEXT'],
    ['bunny_storage', 'INTEGER NOT NULL DEFAULT 0'],
    ['bunny_storage_zone', 'TEXT'],
    ['bunny_access_key', 'TEXT'],
    ['bunny_endpoint', 'TEXT'],
    ['bunny_public_url', 'TEXT'],
    ['cdn_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['cdn_base_url', 'TEXT'],
    ['cdn_signing_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['cdn_signing_key', 'TEXT'],
    ['cdn_signing_ttl', 'INTEGER NOT NULL DEFAULT 3600'],
    ['cdn_cache_purge_url', 'TEXT'],
    ['cdn_cache_purge_token', 'TEXT'],
    ['cdn_cache_control', 'TEXT'],
    ['cdn_cors_origins', 'TEXT'],
    ['cdn_media_headers', 'TEXT'],
  ];
  for (const [col, def] of extra2421Settings) {
    if (!settingCols.has(col)) {
      db.exec(`ALTER TABLE settings ADD COLUMN ${col} ${def}`);
    }
  }
}
