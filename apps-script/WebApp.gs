/**
 * WebApp.gs — entry point ของ Apps Script Web App
 *
 * ตอนนี้ Apps Script เป็น API-only — LIFF frontend host ที่ GitHub Pages
 * (https://pariwat-aruno.github.io/partime-checkin/)
 *
 * doGet  — เปิดในเบราว์เซอร์ปกติเพื่อเช็ค deployment ยังออนไลน์
 * doPost — รับ LIFF API + LINE webhook
 *
 * doPost ตัวเต็ม (route action register/checkin/getBalance/postback) จะมาใน TASK-14
 */

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: 'partime-checkin',
    note: 'API only. UI host ที่ GitHub Pages',
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // LINE webhook event มาเป็น { events: [...] }
    if (Array.isArray(body.events)) {
      body.events.forEach(function (ev) {
        if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
          handleMessageEvent_(ev);
        }
      });
      return jsonOut_({ ok: true });
    }

    // LIFF action จะมาเป็น { action: '...', payload: {...} } — TASK-14 จะ route
    return jsonOut_({ ok: false, error: 'unknown_request' });
  } catch (err) {
    logToSheet_('error', 'doPost', err.message, e && e.postData ? e.postData.contents : '');
    return jsonOut_({ ok: false, error: err.message });
  }
}

/**
 * จัดการ message event (ใช้ตอนนี้แค่ตอบ userId เมื่อพิมพ์ "id")
 * ตัวเต็มจะอยู่ใน TASK-19
 */
function handleMessageEvent_(ev) {
  const userId = ev.source && ev.source.userId;
  const text = (ev.message.text || '').trim();
  const replyToken = ev.replyToken;

  logToSheet_('info', 'message', text, JSON.stringify({ userId: userId }));

  let replyText;
  if (text.toLowerCase() === 'id') {
    replyText =
      'LINE User ID ของคุณ:\n\n' + userId + '\n\n' +
      'copy ส่งให้พี่ปุ้ย (เจ้าของ) เพื่อตั้งเป็น OWNER_LINE_USER_ID';
  } else {
    replyText = 'พิมพ์ "id" เพื่อรับ LINE User ID ของคุณ';
  }

  replyMessage_(replyToken, replyText);
}

/**
 * เรียก LINE Reply API — ใช้ access token จาก Script Properties
 * (LineApi.gs ตัวเต็มจะมาใน TASK-12)
 */
function replyMessage_(replyToken, text) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) {
    logToSheet_('error', 'replyMessage', 'LINE_CHANNEL_ACCESS_TOKEN ไม่ถูกตั้งค่า', '');
    return;
  }
  const payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: text }],
  };
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    logToSheet_('error', 'replyMessage', 'LINE reply ' + res.getResponseCode(), res.getContentText());
  }
}

/**
 * helper minimal — เขียน log ลง Sheet Logs
 * (Logger.gs ตัวเต็มจะมาใน TASK-10)
 */
function logToSheet_(level, fnName, message, payload) {
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!sheetId) return;
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Logs');
    if (!sh) return;
    sh.appendRow([
      new Date().toISOString(),
      level,
      fnName,
      message,
      payload || '',
    ]);
  } catch (err) {
    console.error('logToSheet failed', err);
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
