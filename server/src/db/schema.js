import { execute } from './mysql.js';

let uploadedTableReady = false;
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
  auxTablesReady = true;
}

export async function initSchema() {
  await ensureAuxMySqlTables();
}
