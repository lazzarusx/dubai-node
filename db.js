const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  database:           process.env.DB_NAME     || 'dubai_panel',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASS     || '',
  charset:            'utf8mb4',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function getSetting(key, defaultValue = '') {
  try {
    const row = await queryOne('SELECT value FROM settings WHERE `key` = ? LIMIT 1', [key]);
    return row ? row.value : defaultValue;
  } catch { return defaultValue; }
}

async function setSetting(key, value) {
  await query(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?, updated_at = NOW()',
    [key, value, value]
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
