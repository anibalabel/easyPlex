import { getAllPermissionsList } from '../config/permissions.js';
import { execute, nowIso, queryOne, runInTransaction, isMySql, hasColumn } from './sqlite.js';
import { hashPassword } from '../services/crypto.js';

export async function ensureCoreSeed() {
  const now = nowIso();
  const mysql = isMySql();

  await runInTransaction(async () => {
    // 1. Sync granular permissions cleanly in either dialect
    const permCount = Number((await queryOne(`SELECT COUNT(*) AS c FROM permissions`))?.c || 0);
    if (!mysql || permCount === 0) {
      const perms = getAllPermissionsList();
      for (const perm of perms) {
        if (mysql) {
          await execute(
            `INSERT INTO permissions (\`key\`, module, action, label, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action), label = VALUES(label), updated_at = VALUES(updated_at)`,
            [perm.key, perm.module, perm.action, perm.label, now, now]
          );
        } else {
          await execute(
            `INSERT INTO permissions (\`key\`, module, action, label, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(\`key\`) DO UPDATE SET module = excluded.module, action = excluded.action, label = excluded.label, updated_at = excluded.updated_at`,
            [perm.key, perm.module, perm.action, perm.label, now, now]
          );
        }
      }
    }

    // Seed app_colors (auxiliary React/Mobile table) if empty
    const colorsCount = Number((await queryOne(`SELECT COUNT(*) AS c FROM app_colors`))?.c || 0);
    if (colorsCount === 0) {
      const defaultColors = [
        ['main_color', '#00b4ca', 'Primary brand accent color'],
        ['fragment_featured_overlay_start', '#2E1A00', 'Featured banner gradient start'],
        ['fragment_featured_overlay_center', '#FF6B35', 'Featured banner gradient center'],
        ['fragment_featured_overlay_end', '#3E2A10', 'Featured banner gradient end'],
      ];
      for (const [name, value, desc] of defaultColors) {
        const prefix = mysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO';
        await execute(
          `${prefix} app_colors (color_name, color_value, color_description, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
          [name, value, desc, now, now]
        );
      }
    }

    // Seed installer_state if empty
    const installerRow = await queryOne(`SELECT id FROM installer_state LIMIT 1`);
    if (!installerRow) {
      await execute(
        `INSERT INTO installer_state (installed, installed_at, app_name, admin_email, db_driver)
         VALUES (1, ?, ?, 'admin@easyplex.com', ?)`,
        [now, mysql ? 'easyplex-mobile' : 'EASYPLEX', mysql ? 'mysql' : 'sqlite']
      );
    }

    // In live MySQL mode, NEVER overwrite existing users, settings, ads, or catalog
    if (mysql) {
      return;
    }

    // 2. Seed core SQLite users if empty
    const hasVerified = await hasColumn('users', 'verified');
    const adminUser = await queryOne(`SELECT id FROM users WHERE email = ?`, ['admin@easyplex.com']);
    if (!adminUser) {
      await execute(
        hasVerified
          ? `INSERT INTO users (role, name, email, premuim, verfied, verified, active, password, created_at, updated_at)
             VALUES ('admin', 'admin', 'admin@easyplex.com', 1, 1, 1, 1, ?, ?, ?)`
          : `INSERT INTO users (role, name, email, premuim, verfied, active, password, created_at, updated_at)
             VALUES ('admin', 'admin', 'admin@easyplex.com', 1, 1, 1, ?, ?, ?)`,
        [hashPassword('ChangeMe!EasyPlex24'), now, now]
      );
    }

    const demoUser = await queryOne(`SELECT id FROM users WHERE email = ?`, ['user@easyplex.com']);
    if (!demoUser) {
      await execute(
        hasVerified
          ? `INSERT INTO users (role, name, email, premuim, verfied, verified, active, password, created_at, updated_at)
             VALUES ('user', 'user', 'user@easyplex.com', 0, 0, 0, 1, ?, ?, ?)`
          : `INSERT INTO users (role, name, email, premuim, verfied, active, password, created_at, updated_at)
             VALUES ('user', 'user', 'user@easyplex.com', 0, 0, 1, ?, ?, ?)`,
        [hashPassword('ChangeMe!EasyPlexUser24'), now, now]
      );
    }

    // 3. Seed default servers
    const serverCount = Number((await queryOne(`SELECT COUNT(*) AS c FROM servers`))?.c || 0);
    if (serverCount === 0) {
      for (const name of ['480P', '720P', '1080P', '4K']) {
        await execute(
          `INSERT INTO servers (name, status, created_at, updated_at) VALUES (?, 1, ?, ?)`,
          [name, now, now]
        );
      }
    }

    // 4. Seed default settings row
    const settingsRow = await queryOne(`SELECT id FROM settings WHERE id = 1`);
    if (!settingsRow) {
      await execute(
        `INSERT INTO settings (id, app_name, webpanelversion, license_activation_valid, created_at, updated_at)
         VALUES (1, 'EASYPLEX', '2.4', 1, ?, ?)`,
        [now, now]
      );
    }

    // 5. Seed statistics
    const statsRow = await queryOne(`SELECT id FROM statistics WHERE id = 1`);
    if (!statsRow) {
      await execute(`INSERT INTO statistics (id, installs, created_at, updated_at) VALUES (1, 0, ?, ?)`, [now, now]);
    }

    // 6. Seed default VAST ad
    const adsCount = Number((await queryOne(`SELECT COUNT(*) AS c FROM ads`))?.c || 0);
    if (adsCount === 0) {
      await execute(
        `INSERT INTO ads (title, link, clickThroughUrl, customVast, duration, skipoffset, created_at, updated_at)
         VALUES ('google', ?, ?, 0, '30', '5', ?, ?)`,
        [
          'https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/ad_rule_samples&ciu_szs=300x250&ad_rule=1&impl=s&gdfp_req=1&env=vp&output=vmap&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_ar%3Dpremidpost&cmsid=496&vid=short_onecue&correlator=',
          'https://codecanyon.net/item/easyplex-movies-live-streaming-tv-series-anime/28462799',
          now,
          now,
        ]
      );
    }

    // 7. Seed branding_settings
    const brandingRow = await queryOne(`SELECT id FROM branding_settings WHERE id = 1`);
    if (!brandingRow) {
      await execute(
        `INSERT INTO branding_settings (id, toolbar_logo, created_at, updated_at) VALUES (1, 'app_logo', ?, ?)`,
        [now, now]
      );
    }

    // 8. Seed auto_subtitle_settings
    const autoSubRow = await queryOne(`SELECT id FROM auto_subtitle_settings WHERE id = 1`);
    if (!autoSubRow) {
      await execute(
        `INSERT INTO auto_subtitle_settings (id, enabled, default_languages, apply_to_bulk_import, apply_to_manual_add, skip_if_exists, max_subtitles_per_language, min_download_count, notify_on_completion, retry_on_failure, retry_attempts, created_at, updated_at)
         VALUES (1, 0, '["en","es"]', 1, 1, 1, 1, 0, 0, 1, 2, ?, ?)`,
        [now, now]
      );
    }

    // 9. Seed mail_settings
    const mailRow = await queryOne(`SELECT id FROM mail_settings WHERE id = 1`);
    if (!mailRow) {
      await execute(
        `INSERT INTO mail_settings (id, mail_driver, mail_port, mail_from_name, created_at, updated_at)
         VALUES (1, 'smtp', 587, 'EASYPLEX', ?, ?)`,
        [now, now]
      );
    }
  });
}

export async function seedDemoData() {
  if (isMySql()) return;
  const now = nowIso();
  const moviesCount = Number((await queryOne(`SELECT COUNT(*) AS c FROM movies`))?.c || 0);
  if (moviesCount > 0) return;

  await runInTransaction(async () => {
    const genres = ['Action', 'Sci-Fi', 'Drama', 'Animation', 'Thriller', 'Comedy'];
    const genreIds = {};
    for (const g of genres) {
      const existing = await queryOne(`SELECT id FROM genres WHERE name = ?`, [g]);
      if (existing) {
        genreIds[g] = existing.id;
      } else {
        const res = await execute(`INSERT INTO genres (name, created_at, updated_at) VALUES (?, ?, ?)`, [g, now, now]);
        genreIds[g] = Number(res.lastInsertRowid);
      }
    }

    for (const cat of ['Sports', 'News', 'Entertainment', 'Movies 24/7']) {
      await execute(`INSERT INTO categories (name, created_at, updated_at) VALUES (?, ?, ?)`, [cat, now, now]);
    }

    const langs = [
      ['en', 'English', 'English', 1],
      ['es', 'Spanish', 'Español', 1],
      ['fr', 'French', 'Français', 0],
      ['ja', 'Japanese', '日本語', 1],
    ];
    for (const [iso, eng, name, featured] of langs) {
      await execute(
        `INSERT OR IGNORE INTO languages (iso_639_1, english_name, name, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [iso, eng, name, featured, now, now]
      );
    }

    await execute(`INSERT INTO headers (name, status, created_at, updated_at) VALUES ('Referer: https://easyplex.local', 1, ?, ?)`, [now, now]);
    await execute(`INSERT INTO user_agents (name, url, created_at, updated_at) VALUES ('EasyPlex Mobile Player', 'EasyPlexPlayer/2.4 (Android)', ?, ?)`, [now, now]);
    await execute(`INSERT INTO drms (name, named, status, created_at, updated_at) VALUES ('Widevine L1', 'widevine', 1, ?, ?)`, [now, now]);

    await execute(
      `INSERT INTO plans (name, slug, description, features, max_devices, max_profiles, is_featured, is_active, sort_order, trial_days, price, stripe_plan_id, stripe_price_id, pack_duration, currency, \`interval\`, interval_count, created_at, updated_at)
       VALUES
       ('Basic Monthly', 'basic-monthly', 'HD streaming on 1 device', '["720p & 1080p HD","1 Simultaneous Device","Ad-free experience"]', 1, 2, 0, 1, 1, 7, '4.99', 'plan_basic', 'price_basic', '30', 'USD', 'month', 1, ?, ?),
       ('Pro Ultra 4K', 'pro-ultra-4k', '4K HDR streaming + downloads on 4 devices', '["4K Ultra HD","4 Simultaneous Devices","Offline Downloads","VIP Live Channels"]', 4, 5, 1, 1, 2, 14, '9.99', 'plan_pro', 'price_pro', '30', 'USD', 'month', 1, ?, ?)`,
      [now, now, now, now]
    );

    await execute(
      `INSERT INTO credit_packages (name, credits_amount, price, currency, status, sort_order, created_at, updated_at)
       VALUES ('Starter Pack', 50, 4.99, 'USD', 'enabled', 1, ?, ?),
              ('Cinema Pack', 150, 12.99, 'USD', 'enabled', 2, ?, ?)`,
      [now, now, now, now]
    );

    const m1 = await execute(
      `INSERT INTO movies (tmdb_id, title, original_name, subtitle, overview, poster_path, backdrop_path, vote_average, popularity, runtime, views, featured, premuim, active, release_date, pinned, created_at, updated_at)
       VALUES (603, 'The Matrix', 'The Matrix', 'Welcome to the Real World', 'A computer hacker learns from mysterious rebels about the true nature of his reality.', 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', 'https://image.tmdb.org/t/p/w780/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg', 8.7, 98.5, '136', 1420, 1, 0, 1, '1999-03-31', 1, ?, ?)`,
      [now, now]
    );
    const movieId = Number(m1.lastInsertRowid);
    await execute(`INSERT INTO movie_genres (movie_id, genre_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, [movieId, genreIds['Sci-Fi'], now, now]);
    await execute(`INSERT INTO movie_videos (movie_id, server, quality, link, lang, hls, status, is_active, position, created_at, updated_at) VALUES (?, '1080P', '1080P', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'English', 1, 1, 1, 1, ?, ?)`, [movieId, now, now]);

    const s1 = await execute(
      `INSERT INTO series (tmdb_id, name, original_name, imdb_external_id, subtitle, overview, poster_path, backdrop_path, vote_average, popularity, views, featured, premuim, active, number_of_seasons, number_of_episodes, first_air_date, created_at, updated_at)
       VALUES (1399, 'Game of Thrones', 'Game of Thrones', 'tt0944947', 'Winter is Coming', 'Nine noble families fight for control over the lands of Westeros.', 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg', 'https://image.tmdb.org/t/p/w780/suopoADq0k8YZr4dQXcU6pToj6s.jpg', 8.4, 150.2, 2150, 1, 1, 1, 1, 1, '2011-04-17', ?, ?)`,
      [now, now]
    );
    const serieId = Number(s1.lastInsertRowid);
    await execute(`INSERT INTO serie_genres (serie_id, genre_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, [serieId, genreIds['Drama'], now, now]);
    const seasonRes = await execute(
      `INSERT INTO seasons (serie_id, season_number, name, overview, air_date, created_at, updated_at) VALUES (?, 1, 'Season 1', 'The first season.', '2011-04-17', ?, ?)`,
      [serieId, now, now]
    );
    const seasonId = Number(seasonRes.lastInsertRowid);
    const epRes = await execute(
      `INSERT INTO episodes (season_id, episode_number, name, overview, vote_average, views, air_date, created_at, updated_at) VALUES (?, 1, 'Winter Is Coming', 'Eddard Stark is torn between his family and an old friend.', 8.5, 420, '2011-04-17', ?, ?)`,
      [seasonId, now, now]
    );
    await execute(
      `INSERT INTO serie_videos (episode_id, server, quality, link, lang, hls, status, is_active, position, created_at, updated_at) VALUES (?, '1080P', '1080P', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'English', 1, 1, 1, 1, ?, ?)`,
      [Number(epRes.lastInsertRowid), now, now]
    );

    const a1 = await execute(
      `INSERT INTO animes (tmdb_id, name, original_name, imdb_external_id, subtitle, overview, poster_path, backdrop_path, vote_average, popularity, views, featured, premuim, active, number_of_seasons, number_of_episodes, first_air_date, created_at, updated_at)
       VALUES (37854, 'One Piece', 'ONE PIECE', 'tt0388629', 'Set Sail!', 'Monkey D. Luffy sets off on an adventure to find the legendary treasure One Piece.', 'https://image.tmdb.org/t/p/w500/fcXdJlbSdUEeMSJFsXKsznGwwok.jpg', 'https://image.tmdb.org/t/p/w780/a6ptrTUH1c5OdWanjyYNbSdULgW.jpg', 8.7, 210.0, 3100, 1, 0, 1, 1, 1, '1999-10-20', ?, ?)`,
      [now, now]
    );
    const animeId = Number(a1.lastInsertRowid);
    await execute(`INSERT INTO anime_genres (anime_id, genre_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, [animeId, genreIds['Animation'], now, now]);

    const tvRes = await execute(
      `INSERT INTO livetvs (name, overview, poster_path, link, featured, hls, active, vip, views, created_at, updated_at)
       VALUES ('EasyPlex Cinema 24/7', 'Non-stop HD cinema stream.', 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 1, 1, 1, 0, 680, ?, ?)`,
      [now, now]
    );
    await execute(
      `INSERT INTO livetv_videos (livetv_id, server, quality, link, hls, status, is_active, sort_order, created_at, updated_at) VALUES (?, 'Main HLS', '1080P', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 1, 1, 1, 1, ?, ?)`,
      [Number(tvRes.lastInsertRowid), now, now]
    );

    await execute(
      `INSERT INTO featureds (featured_id, title, poster_path, backdrop_path, vote_average, type, genre, premuim, position, quality, created_at, updated_at)
       VALUES (?, 'The Matrix', 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', 'https://image.tmdb.org/t/p/w780/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg', 8.7, 'movie', 'Sci-Fi', 0, 1, '1080P', ?, ?)`,
      [movieId, now, now]
    );
    await execute(
      `INSERT INTO top10s (position, title, overview, media_id, poster_path, backdrop_path, type, genre, vote_average, release_date, quality, premium, created_at, updated_at)
       VALUES (1, 'The Matrix', 'A computer hacker learns about the Matrix.', ?, 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', 'https://image.tmdb.org/t/p/w780/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg', 'movie', 'Sci-Fi', '8.7', '1999-03-31', '1080P', 0, ?, ?)`,
      [movieId, now, now]
    );
  });
}
