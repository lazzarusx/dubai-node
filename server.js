require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path      = require('path');

const { pool, ensureActivityLogsTable } = require('./db');
const siteRouter  = require('./routes/site');
const apiRouter   = require('./routes/api');
const adminRouter = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// Vercel proxy arkasında çalışıyor — güvenli cookie için gerekli
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session — PostgreSQL store (serverless-safe)
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret:            process.env.SESSION_SECRET || 'changeme',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   24 * 60 * 60 * 1000,
  },
}));

// ─── IP Ban middleware ─────────────────────────────────────────────────────────
let bannedIpsCache = { list: [], time: 0 };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api')) return next();
  if (req.path.startsWith('/public') || req.path.includes('.')) return next();
  try {
    const now = Date.now();
    if (now - bannedIpsCache.time > 30000) {
      const raw = await pool.query("SELECT value FROM settings WHERE key='banned_ips' LIMIT 1");
      bannedIpsCache.list = JSON.parse(raw.rows[0]?.value || '[]');
      bannedIpsCache.time = now;
    }
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress || '';
    if (bannedIpsCache.list.includes(ip)) {
      return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Blocked</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#0f2027;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;border-radius:16px;padding:40px 32px;max-width:400px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:16px}.title{font-size:20px;font-weight:800;color:#dc2626;margin-bottom:8px}.msg{font-size:14px;color:#6b7280;line-height:1.5}</style></head><body><div class="card"><div class="icon">🚫</div><div class="title">Access Blocked</div><div class="msg">Your access to this service has been blocked. If you believe this is an error, please contact support.</div></div></body></html>');
    }
  } catch {}
  next();
});

// Routes
app.use('/',      siteRouter);
app.use('/api',   apiRouter);
app.use('/admin', adminRouter);

// Auto-run DB migrations on startup (safe — IF NOT EXISTS)
pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NULL')
  .catch(e => console.log('Migration note:', e.message));

pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT ''")
  .catch(e => console.log('Migration note (comment):', e.message));

ensureActivityLogsTable().catch(console.error);

// 404
app.use((req, res) => res.status(404).send('Sayfa bulunamadı.'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Sunucu hatası:', err.stack || err.message);
  res.status(500).send('Sunucu hatası: ' + err.message);
});

app.listen(PORT, () => {
  console.log(`✅ Dubai Node sunucu başlatıldı → http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin`);
});
