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

module.exports = { pool, query, queryOne, getSetting, setSetting, clientIp };
