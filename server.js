require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const path     = require('path');

const siteRouter  = require('./routes/site');
const apiRouter   = require('./routes/api');
const adminRouter = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'changeme',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// Routes
app.use('/',      siteRouter);
app.use('/api',   apiRouter);
app.use('/admin', adminRouter);

// 404
app.use((req, res) => res.status(404).send('Sayfa bulunamadı.'));

app.listen(PORT, () => {
  console.log(`✅ Dubai Node sunucu başlatıldı → http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin`);
});
