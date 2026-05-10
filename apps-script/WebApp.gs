/**
 * WebApp.gs — entry point ของ Apps Script Web App (TASK-14, TASK-19)
 *
 * Apps Script เป็น API-only — LIFF frontend host ที่ GitHub Pages
 *
 * doGet  — health check
 * doPost — รับ 2 ชนิด:
 *   1. LINE webhook event (มี field `events`)
 *   2. LIFF action (มี field `action` + `payload`)
 */

function doGet(e) {
  return jsonOut_({
    ok: true,
    service: 'partime-checkin',
    version: '0.2',
    note: 'API only. UI host ที่ GitHub Pages',
  });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    logError('doPost', 'invalid JSON: ' + err.message, e && e.postData ? e.postData.contents : '');
    return jsonOut_({ ok: false, error: 'invalid_json' });
  }

  try {
    // Webhook event (LINE)
    if (Array.isArray(body.events)) {
      body.events.forEach(handleLineEvent_);
      return jsonOut_({ ok: true });
    }

    // LIFF action
    if (body.action) {
      const result = routeAction_(body.action, body.payload || {});
      return jsonOut_(result);
    }

    return jsonOut_({ ok: false, error: 'unknown_request' });
  } catch (err) {
    logError('doPost', err.message, body);
    return jsonOut_({ ok: false, error: err.message });
  }
}

/** route LIFF action → handler */
function routeAction_(action, payload) {
  switch (action) {
    case 'register':     return register(payload);
    case 'checkin':      return checkin(payload);
    case 'getBalance':   return getBalance(payload);
    case 'closePeriod':  return closePeriod(payload);
    default:
      return { ok: false, error: 'unknown_action', action: action };
  }
}

/** จัดการ LINE event ทุกชนิด */
function handleLineEvent_(ev) {
  if (!ev || !ev.type) return;

  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    return handleMessageEvent_(ev);
  }

  if (ev.type === 'postback') {
    return handlePostback_(ev);
  }

  if (ev.type === 'follow') {
    // user เพิ่ม bot เป็นเพื่อน → ส่งข้อความ welcome
    return replyText(ev.replyToken,
      'ยินดีต้อนรับสู่ partime-checkin\n' +
      '- กดเมนู "ลงทะเบียน" เพื่อสมัครครั้งแรก\n' +
      '- หรือพิมพ์ "id" เพื่อรับ LINE User ID ของคุณ');
  }
}

/**
 * message event:
 *   "id" → reply userId
 *   อื่น ๆ → reply hint
 */
function handleMessageEvent_(ev) {
  const userId = ev.source && ev.source.userId;
  const text = (ev.message.text || '').trim();
  logInfo('message', text, { userId: userId });

  if (text.toLowerCase() === 'id') {
    return replyText(ev.replyToken,
      'LINE User ID ของคุณ:\n\n' + userId + '\n\n' +
      'copy ส่งให้พี่ปุ้ย (เจ้าของ) เพื่อตั้งเป็น OWNER_LINE_USER_ID');
  }

  return replyText(ev.replyToken,
    'พิมพ์ "id" เพื่อรับ LINE User ID ของคุณ\n' +
    'หรือใช้เมนูด้านล่างเพื่อ ลงทะเบียน / เช็คอิน / ดูยอด');
}

/**
 * TASK-19 — handle postback จาก flex card อนุมัติ
 *
 * data format:
 *   action=approve&id=CHK-...&type=full
 *   action=approve&id=CHK-...&type=half
 *   action=reject&id=CHK-...
 *
 * verify: เฉพาะ OWNER_LINE_USER_ID เท่านั้นที่กดได้
 */
function handlePostback_(ev) {
  const userId = ev.source && ev.source.userId;
  const ownerUserId = PropertiesService.getScriptProperties().getProperty('OWNER_LINE_USER_ID');
  if (userId !== ownerUserId) {
    logWarn('postback', 'unauthorized user', { userId: userId });
    return replyText(ev.replyToken, 'คุณไม่มีสิทธิ์อนุมัติ — เฉพาะเจ้าของเท่านั้น');
  }

  const data = parsePostbackData_(ev.postback.data);
  if (!data.action || !data.id) {
    logWarn('postback', 'invalid data', ev.postback.data);
    return replyText(ev.replyToken, 'ข้อมูลผิดพลาด');
  }

  if (data.action === 'approve' || data.action === 'reject') {
    const result = updateCheckinStatus_(data.id, data.action, data.type);
    if (!result.ok) {
      return replyText(ev.replyToken, '❌ ' + result.error);
    }
    return replyText(ev.replyToken, formatApprovalReply_(result));
  }

  return replyText(ev.replyToken, 'unknown action: ' + data.action);
}

function parsePostbackData_(s) {
  const out = {};
  if (!s) return out;
  s.split('&').forEach(function (pair) {
    const kv = pair.split('=');
    out[kv[0]] = decodeURIComponent(kv[1] || '');
  });
  return out;
}

/**
 * อัปเดต Checkins row → status, day_type, wage, approved_at
 *
 * approve full → status=approved, day_type=full, wage=400 (จาก config)
 * approve half → status=approved, day_type=half, wage=200
 * reject       → status=rejected, day_type=none, wage=0
 */
function updateCheckinStatus_(checkinId, action, type) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'no_checkins' };

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  let rowIdx = -1;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === checkinId) { rowIdx = i + 2; break; }
  }
  if (rowIdx < 0) return { ok: false, error: 'checkin_not_found: ' + checkinId };

  const cfg = getConfig();
  let status, dayType, wage;
  if (action === 'approve' && type === 'full') {
    status = 'approved'; dayType = 'full'; wage = Number(cfg.wage_full_day);
  } else if (action === 'approve' && type === 'half') {
    status = 'approved'; dayType = 'half'; wage = Number(cfg.wage_half_day);
  } else if (action === 'reject') {
    status = 'rejected'; dayType = 'none'; wage = 0;
  } else {
    return { ok: false, error: 'invalid_combo' };
  }

  const iStatus = headers.indexOf('status') + 1;
  const iDayType = headers.indexOf('day_type') + 1;
  const iWage = headers.indexOf('wage') + 1;
  const iApprovedAt = headers.indexOf('approved_at') + 1;
  const iEmp = headers.indexOf('employee_id');
  const iDate = headers.indexOf('checkin_date');

  sh.getRange(rowIdx, iStatus).setValue(status);
  sh.getRange(rowIdx, iDayType).setValue(dayType);
  sh.getRange(rowIdx, iWage).setValue(wage);
  sh.getRange(rowIdx, iApprovedAt).setValue(nowBangkok());

  // ดึงชื่อ employee สำหรับ reply
  const rowData = sh.getRange(rowIdx, 1, 1, sh.getLastColumn()).getValues()[0];
  const empId = rowData[iEmp];
  const date = rowData[iDate];
  const dateStr = (date instanceof Date)
    ? Utilities.formatDate(date, 'Asia/Bangkok', 'd MMM yyyy')
    : String(date);

  const emp = findEmployeeById_(empId);
  const empName = emp ? emp.display_name : empId;

  logInfo('postback', action, { checkinId: checkinId, type: type, employeeId: empId });

  return {
    ok: true,
    checkinId: checkinId,
    employeeName: empName,
    date: dateStr,
    status: status,
    dayType: dayType,
    wage: wage,
  };
}

function formatApprovalReply_(r) {
  if (r.status === 'rejected') {
    return '✅ ไม่อนุมัติเรียบร้อย\n' + r.employeeName + ' — ' + r.date;
  }
  const t = r.dayType === 'full' ? 'เต็มวัน' : 'ครึ่งวัน';
  return '✅ อนุมัติเรียบร้อย\n' + r.employeeName + ' — ' + r.date + '\n' + t + ' ' + r.wage + ' บาท';
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
