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
      const auth = authenticateLiffRequest_(body);
      if (!auth.ok) return jsonOut_(auth);

      const payload = body.payload || {};
      payload.lineUserId = auth.lineUserId;

      const result = routeAction_(body.action, payload);
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
    case 'register':           return register(payload);
    case 'checkin':            return checkin(payload);
    case 'getBalance':         return getBalance(payload);
    case 'getTodayStatus':     return getTodayStatus(payload);
    case 'getDailyReport':     return getDailyReport(payload);
    // owner-only (verify ใน handler)
    case 'getOwnerDashboard':     return getOwnerDashboard(payload);
    case 'getPendingForEmployee': return getPendingForEmployee(payload);
    case 'approveCheckin':        return approveCheckin(payload);
    case 'closePeriod':           return closePeriod(payload);
    case 'markPaid':              return markPaid(payload);
    case 'getOwnerLogs':          return getOwnerLogs(payload);
    default:
      return { ok: false, error: 'unknown_action', action: action };
  }
}

/**
 * Verify LIFF idToken with LINE, then use token `sub` as trusted lineUserId.
 *
 * Backward/dev escape hatch:
 * set Script Property DEV_ALLOW_INSECURE_LIFF=true to allow payload.lineUserId
 * without idToken. Do not enable that in production.
 */
function authenticateLiffRequest_(body) {
  const props = PropertiesService.getScriptProperties();
  const idToken = body && body.idToken;

  if (!idToken) {
    if (props.getProperty('DEV_ALLOW_INSECURE_LIFF') === 'true') {
      const payload = body.payload || {};
      if (payload.lineUserId) return { ok: true, lineUserId: payload.lineUserId, insecureDev: true };
    }
    return { ok: false, error: 'auth_required' };
  }

  const clientId = getLiffChannelId_();
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: {
      id_token: idToken,
      client_id: clientId,
    },
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  let data = {};
  try {
    data = JSON.parse(res.getContentText());
  } catch (_) {
    data = {};
  }

  if (code !== 200 || !data.sub) {
    logWarn('auth', 'LIFF idToken verify failed', { code: code, body: data });
    return { ok: false, error: 'invalid_auth' };
  }

  return { ok: true, lineUserId: data.sub };
}

function getLiffChannelId_() {
  const props = PropertiesService.getScriptProperties();
  const explicit = props.getProperty('LINE_LOGIN_CHANNEL_ID');
  if (explicit) return explicit;

  const liffId = props.getProperty('LIFF_ID_REGISTER') ||
                 props.getProperty('LIFF_ID_CHECKIN') ||
                 props.getProperty('LIFF_ID_BALANCE') ||
                 '';
  const m = String(liffId).match(/^(\d+)-/);
  if (!m) throw new Error('missing LINE_LOGIN_CHANNEL_ID Script Property');
  return m[1];
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
    return replyText(ev.replyToken,
      'ยินดีต้อนรับสู่ บริษัท วอร์ด้า สกินแคร์ จำกัด\n\n' +
      '- พิมพ์ "ลงทะเบียน" เพื่อสมัครครั้งแรก\n' +
      '- กดเมนู "เช็คอิน" เมื่อถึงร้าน\n' +
      '- กดเมนู "ดูยอด" เพื่อดูค่าจ้าง');
  }
}

/**
 * message event:
 *   "id" → reply userId
 *   "รอ" / "pending" → reply carousel ของ pending checkins (เฉพาะเจ้าของ)
 *   อื่น ๆ → reply hint
 */
function handleMessageEvent_(ev) {
  const userId = ev.source && ev.source.userId;
  const text = (ev.message.text || '').trim();
  const lower = text.toLowerCase();
  logInfo('message', text, { userId: userId });

  if (text.toLowerCase() === 'id') {
    return replyText(ev.replyToken,
      'LINE User ID ของคุณ:\n\n' + userId + '\n\n' +
      'คัดลอกส่งให้เจ้าของเพื่อบันทึกในระบบ\n\n' +
      'บริษัท วอร์ด้า สกินแคร์ จำกัด');
  }

  // command "ลงทะเบียน" / "register" / "สมัคร" → ตอบลิงก์ LIFF (ไม่ผูก rich menu แล้ว)
  if (lower === 'ลงทะเบียน' || lower === 'register' || lower === 'สมัคร') {
    const props = PropertiesService.getScriptProperties();
    const liffId = props.getProperty('LIFF_ID_REGISTER');
    return replyText(ev.replyToken,
      'ลงทะเบียนพาร์ทไทม์ใหม่\n\n' +
      'กดที่ลิงก์นี้:\n' +
      'https://liff.line.me/' + liffId + '\n\n' +
      'บริษัท วอร์ด้า สกินแคร์ จำกัด');
  }

  if (lower === 'รอ' || lower === 'pending' || lower === 'รออนุมัติ') {
    return replyPendingApprovals_(ev);
  }

  // "รายงาน" หรือ "รายงาน 2026-05-10"
  const reportMatch = text.match(/^รายงาน\s*(\d{4}-\d{2}-\d{2})?$/);
  if (reportMatch) {
    return replyDailyReport_(ev, reportMatch[1] || null);
  }

  return replyText(ev.replyToken,
    'คำสั่งที่ใช้ได้:\n' +
    '"ลงทะเบียน" — สมัครครั้งแรก (ลิงก์)\n' +
    '"id" — รับ LINE User ID\n' +
    '"รอ" — รายการรออนุมัติ (เจ้าของ)\n' +
    '"รายงาน" หรือ "รายงาน 2026-05-10" — สรุปวัน (เจ้าของ)\n\n' +
    'หรือใช้เมนูด้านล่าง: เช็คอิน / ดูยอด\n\n' +
    'บริษัท วอร์ด้า สกินแคร์ จำกัด');
}

/**
 * เจ้าของพิมพ์ "รอ" → ตอบ carousel flex ของ pending checkins ทั้งหมด
 * (รวมปุ่มอนุมัติ/ไม่อนุมัติเดิม)
 *
 * LINE limit: carousel max 12 bubble — cap ที่ 10 + ส่งข้อความบอกถ้าเหลือ
 */
function replyPendingApprovals_(ev) {
  const userId = ev.source && ev.source.userId;
  if (!isOwner(userId)) {
    return replyText(ev.replyToken, 'เฉพาะเจ้าของเท่านั้นที่ดูรายการรออนุมัติได้');
  }

  const pendingList = listPendingCheckins_();
  if (pendingList.length === 0) {
    return replyText(ev.replyToken, '✅ ไม่มีรายการรออนุมัติ');
  }

  const cfg = getConfig();
  const radius = Number(cfg.geofence_radius_m);
  const MAX_CAROUSEL = 10;

  const bubbles = pendingList.slice(0, MAX_CAROUSEL).map(function (item) {
    const card = buildApprovalCard({
      checkinId: item.checkin_id,
      displayName: item.display_name,
      phone: item.phone,
      date: item.date,
      slots: item.slots,
      referenceSelfieUrl: item.reference_selfie_url,
      lastDistanceM: item.last_distance_m,
      radiusM: radius,
      hasOutOfRange: item.has_out_of_range,
      scanCount: item.scan_count,
    });
    return card.contents; // unwrap bubble
  });

  const messages = [{
    type: 'flex',
    altText: 'รออนุมัติ ' + pendingList.length + ' รายการ',
    contents: { type: 'carousel', contents: bubbles },
  }];

  if (pendingList.length > MAX_CAROUSEL) {
    messages.push({
      type: 'text',
      text: 'แสดง ' + MAX_CAROUSEL + ' รายการแรก จากทั้งหมด ' + pendingList.length + ' รายการ\n' +
            'อนุมัติ/ไม่อนุมัติของเก่าแล้วพิมพ์ "รอ" ใหม่เพื่อดูส่วนที่เหลือ',
    });
  }

  return replyMessage(ev.replyToken, messages);
}

/**
 * คืน list ของ pending checkins (4-slot version) ที่ JOIN กับ Employees แล้ว
 * sort: ใหม่สุดก่อน (checkin_date desc)
 */
function listPendingCheckins_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const checkSh = ss.getSheetByName('Checkins');
  const empSh = ss.getSheetByName('Employees');
  const cfg = getConfig();

  // build employee lookup map
  const empMap = {};
  const empLast = empSh.getLastRow();
  if (empLast >= 2) {
    const eh = empSh.getRange(1, 1, 1, empSh.getLastColumn()).getValues()[0];
    const ed = empSh.getRange(2, 1, empLast - 1, empSh.getLastColumn()).getValues();
    const iId = eh.indexOf('employee_id');
    const iName = eh.indexOf('display_name');
    const iPhone = eh.indexOf('phone');
    const iSelfie = eh.indexOf('selfie_url');
    ed.forEach(function (row) {
      empMap[row[iId]] = {
        display_name: row[iName],
        phone: row[iPhone],
        selfie_url: row[iSelfie],
      };
    });
  }

  const checkLast = checkSh.getLastRow();
  if (checkLast < 2) return [];
  const ch = checkSh.getRange(1, 1, 1, checkSh.getLastColumn()).getValues()[0];
  const cd = checkSh.getRange(2, 1, checkLast - 1, checkSh.getLastColumn()).getValues();

  const iCheckId = ch.indexOf('checkin_id');
  const iEmpId = ch.indexOf('employee_id');
  const iDate = ch.indexOf('checkin_date');
  const iLastDist = ch.indexOf('last_distance_m');
  const iScan = ch.indexOf('scan_count');
  const iOOR = ch.indexOf('has_out_of_range');
  const iStatus = ch.indexOf('status');
  const slotCols = [1, 2, 3, 4].map(function (s) {
    return { at: ch.indexOf('slot' + s + '_at'), url: ch.indexOf('slot' + s + '_url') };
  });

  const pending = [];
  cd.forEach(function (row) {
    if (row[iStatus] !== 'pending') return;
    const emp = empMap[row[iEmpId]] || {};
    const slots = slotCols.map(function (sc, i) {
      const at = row[sc.at];
      const url = row[sc.url];
      return {
        slot: i + 1,
        label: getSlotLabel(cfg, i + 1),
        at: at || '',
        url: url || '',
        completed: !!at,
      };
    });
    pending.push({
      checkin_id: row[iCheckId],
      employee_id: row[iEmpId],
      display_name: emp.display_name || row[iEmpId],
      phone: emp.phone || '',
      reference_selfie_url: emp.selfie_url || '',
      date: row[iDate],
      last_distance_m: Number(row[iLastDist] || 0),
      has_out_of_range: row[iOOR] === true,
      scan_count: Number(row[iScan] || 0),
      slots: slots,
    });
  });

  pending.sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date));
  });
  return pending;
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
  if (!isOwner(userId)) {
    logWarn('postback', 'unauthorized user', { userId: userId });
    return replyText(ev.replyToken, 'คุณไม่มีสิทธิ์อนุมัติ — เฉพาะเจ้าของเท่านั้น');
  }

  const data = parsePostbackData_(ev.postback.data);
  if (!data.action || !data.id) {
    logWarn('postback', 'invalid data', ev.postback.data);
    return replyText(ev.replyToken, 'ข้อมูลผิดพลาด');
  }

  if (data.action === 'approve' || data.action === 'reject') {
    const result = updateCheckinStatus_(data.id, data.action, data.type, userId);
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
function updateCheckinStatus_(checkinId, action, type, ownerUserId) {
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

  // audit log: owner คนไหนทำ approve/reject อะไร
  const ownerAction = (action === 'approve')
    ? (type === 'half' ? 'approve_half' : 'approve_full')
    : 'reject';
  logOwnerAction(ownerUserId, ownerAction, checkinId, empName, {
    date: dateStr,
    wage: wage,
    day_type: dayType,
  });

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
    return 'ไม่อนุมัติเรียบร้อย\n' + r.employeeName + ' — ' + r.date;
  }
  const t = r.dayType === 'full' ? 'เต็มวัน' : 'ครึ่งวัน';
  return 'อนุมัติเรียบร้อย\n' + r.employeeName + ' — ' + r.date + '\n' + t + ' ' + r.wage + ' บาท';
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
