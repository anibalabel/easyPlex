import { execute } from './mysql.js';

let uploadedTableReady = false;
let videoLibraryTableReady = false;
let auxTablesReady = false;

export async function ensureUploadedFilesTable() {
  if (uploadedTableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      folder VARCHAR(64) NOT NULL,
      filename VARCHAR(191) NOT NULL,
      mime_type VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
      size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      content MEDIUMBLOB NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uploaded_files_folder_name_unique (folder, filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  uploadedTableReady = true;
}

export async function ensureAuxMySqlTables() {
  if (auxTablesReady) return;
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

  await ensureUploadedFilesTable();
  await ensureVideoLibraryTable();
  auxTablesReady = true;
}

export async function ensureVideoLibraryTable() {
  if (videoLibraryTableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS video_library (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      title VARCHAR(255) NULL,
      original_name VARCHAR(255) NOT NULL,
      media_type VARCHAR(32) NOT NULL DEFAULT 'movie',
      directory VARCHAR(64) NOT NULL DEFAULT 'movies/originals',
      file_key VARCHAR(512) NOT NULL,
      stream_url TEXT NOT NULL,
      format VARCHAR(32) NOT NULL DEFAULT 'mp4',
      quality VARCHAR(32) NOT NULL DEFAULT 'Original',
      file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      storage VARCHAR(32) NOT NULL DEFAULT 'r2',
      bucket VARCHAR(191) NULL,
      movie_id BIGINT UNSIGNED NULL,
      episode_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_video_library_movie (movie_id),
      KEY idx_video_library_episode (episode_id),
      KEY idx_video_library_storage (storage),
      KEY idx_video_library_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  videoLibraryTableReady = true;
}

export async function initSchema() {
  await ensureAuxMySqlTables();
}
