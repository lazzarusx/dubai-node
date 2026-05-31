const axios  = require('axios');
const crypto = require('crypto');
const { getSetting } = require('../db');

const META_API_VERSION = 'v18.0';
const TIKTOK_ENDPOINT  = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

function sha256(s) {
  if (!s) return undefined;
  return crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
}

function compact(obj) {
  Object.keys(obj).forEach(k => (obj[k] === undefined || obj[k] === '' || obj[k] === null) && delete obj[k]);
  return obj;
}

async function sendMetaCapi({ eventName, eventId, eventSourceUrl, customData, externalId, fbp, fbc, ip, userAgent }) {
  const pixelId  = await getSetting('meta_pixel_id', '');
  const token    = await getSetting('meta_access_token', '');
  const testCode = await getSetting('meta_test_event_code', '');
  if (!pixelId || !token) return { skipped: 'meta_no_credentials' };

  const userData = compact({
    client_ip_address: ip,
    client_user_agent: userAgent,
    fbp, fbc,
    external_id: externalId ? sha256(externalId) : undefined,
  });

  const payload = {
    data: [compact({
      event_name:       eventName,
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         eventId,
      event_source_url: eventSourceUrl,
      action_source:    'website',
      user_data:        userData,
      custom_data:      customData && Object.keys(customData).length ? customData : undefined,
    })],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  try {
    const url  = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
    const resp = await axios.post(url, payload, { timeout: 8000, validateStatus: () => true });
    if (resp.status !== 200) console.error('[CAPI:meta]', resp.status, JSON.stringify(resp.data).slice(0, 300));
    return { ok: resp.status === 200, status: resp.status };
  } catch (e) {
    console.error('[CAPI:meta] error', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendTiktokCapi({ eventName, eventId, eventSourceUrl, properties, externalId, ttp, ttclid, ip, userAgent, referrer }) {
  const pixelId  = await getSetting('tiktok_pixel_id', '');
  const token    = await getSetting('tiktok_access_token', '');
  const testCode = await getSetting('tiktok_test_event_code', '');
  if (!pixelId || !token) return { skipped: 'tiktok_no_credentials' };

  const userData = compact({
    ip, user_agent: userAgent, ttp, ttclid,
    external_id: externalId ? [sha256(externalId)] : undefined,
  });

  const payload = compact({
    event_source:    'web',
    event_source_id: pixelId,
    test_event_code: testCode || undefined,
    data: [compact({
      event:      eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id:   eventId,
      user:       userData,
      properties: properties && Object.keys(properties).length ? properties : undefined,
      page:       eventSourceUrl ? compact({ url: eventSourceUrl, referrer }) : undefined,
    })],
  });

  try {
    const resp = await axios.post(TIKTOK_ENDPOINT, payload, {
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      timeout: 8000, validateStatus: () => true,
    });
    const ok = resp.status === 200 && resp.data?.code === 0;
    if (!ok) console.error('[CAPI:tiktok]', resp.status, JSON.stringify(resp.data).slice(0, 300));
    return { ok, status: resp.status, code: resp.data?.code };
  } catch (e) {
    console.error('[CAPI:tiktok] error', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendMetaCapi, sendTiktokCapi };
