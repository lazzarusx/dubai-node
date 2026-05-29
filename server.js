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
