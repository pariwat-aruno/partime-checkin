/**
 * EndToday.gs — /today, /endtoday + เมนูตัดสินค่าจ้างปลายวัน  [P4]
 *
 * - decideCheckin_()      : core ตัดสิน day_type → คิดเงินด้วย computeWage_
 * - terminateEmployee_()  : เลิกจ้าง + ปิดยอดวันนั้นทันที (closeDailyForEmployee_ = P6)
 * - replyTodayCommand_()  : /today รายชื่อคนมาวันนี้
 * - replyEndTodayCommand_/sendEndTodayMenu_ : เมนูปิดวัน (carousel)
 *
 * postback ที่เกี่ยวข้อง (handle ใน WebApp.handlePostback_):
 *   action=decide&id=CHK..&type=full|half|h1|h2|h3
 *   action=absent&id=CHK..              (ไม่มาทำงาน — มีอยู่แล้ว)
 *   action=terminate&emp=EMP..          (เลิกจ้าง)
 */

/** map ปุ่ม endtoday → { dayType, workHours } */
function decodeDayTypeButton_(type) {
  switch (type) {
    case 'full': return { dayType: 'full', hours: 0 };
    case 'half': return { dayType: 'half', hours: 0 };
    case 'h1':   return { dayType: 'custom', hours: 1 };
    case 'h2':   return { dayType: 'custom', hours: 2 };
    case 'h3':   return { dayType: 'custom', hours: 3 };
    default:     return null;
  }
}

/** core: ตัดสิน checkin หนึ่งรายการ → เขียน status/day_type/work_hours/wage/late */
function decideCheckin_(checkinId, dayType, workHours, ownerUserId) {
  const c = readCheckinById_(checkinId);
  if (!c) return { ok: false, error: 'checkin_not_found: ' + checkinId };

  const cfg = getConfig();
  const emp = findEmployeeById_(c.employee_id);
  const w = computeWage_(emp, c.slot1_at, dayType, workHours, cfg);
  const status = (dayType === 'absent') ? 'absent' : 'approved';

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const setCol = function (name, val) {
    const i = headers.indexOf(name);
    if (i >= 0) sh.getRange(c._rowNumber, i + 1).setValue(val);
  };
  setCol('status', status);
  setCol('day_type', dayType);
  setCol('work_hours', dayType === 'custom' ? (Number(workHours) || 0) : '');
  setCol('wage', w.net);
  setCol('late_minutes', w.lateMinutes);
  setCol('late_deduction', w.deduction);
  setCol('approved_at', nowBangkok());

  const dateStr = formatBangkokDateOnly_(c.checkin_date);
  logOwnerAction(ownerUserId, 'decide_' + dayType, checkinId,
    emp ? emp.display_name : c.employee_id, {
      date: dateStr, day_type: dayType, work_hours: workHours,
      wage: w.net, late: w.lateMinutes, deduction: w.deduction,
    });

  return {
    ok: true,
    empName: emp ? employeeDisplay_(emp) : c.employee_id,
    dayType: dayType, workHours: workHours,
    wage: w.net, lateMinutes: w.lateMinutes, deduction: w.deduction,
  };
}

/** เลิกจ้าง — set terminated_at + is_active=false + ปิดยอดวันนั้นทันที */
function terminateEmployee_(employeeId, ownerUserId) {
  const emp = findEmployeeById_(employeeId);
  if (!emp) return { ok: false, error: 'employee_not_found' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Employees');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const setCol = function (name, val) {
    const i = headers.indexOf(name);
    if (i >= 0) sh.getRange(emp._rowNumber, i + 1).setValue(val);
  };
  setCol('terminated_at', nowBangkok());
  setCol('is_active', false);

  logOwnerAction(ownerUserId, 'terminate', employeeId, emp.display_name, {});

  // ปิดยอดวันนั้นทันที (P6) — ถ้ายังไม่มีฟังก์ชันก็ข้ามไป
  let closed = null;
  try {
    if (typeof closeDailyForEmployee_ === 'function') {
      closed = closeDailyForEmployee_(employeeId, todayBangkok(), ownerUserId, true);
    }
  } catch (e) {
    logError('terminate', 'daily close failed: ' + e.message, { employeeId: employeeId });
  }
  return { ok: true, empName: employeeDisplay_(emp), closed: closed };
}

// ========================================================================
// /today
// ========================================================================

/** อ่านรายชื่อคนที่มี checkin วันนี้ (join ชื่อ/ชื่อเล่น) */
function getTodayWorkers_() {
  const today = todayBangkok();
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName('Checkins');
  const last = sh.getLastRow();
  const workers = [];
  if (last < 2) return workers;

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const d = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iId = h.indexOf('checkin_id');
  const iEmp = h.indexOf('employee_id');
  const iDate = h.indexOf('checkin_date');
  const iSlot1 = h.indexOf('slot1_at');
  const iScan = h.indexOf('scan_count');
  const iStatus = h.indexOf('status');
  const iDayType = h.indexOf('day_type');
  const iWage = h.indexOf('wage');
  const iOOR = h.indexOf('has_out_of_range');
  const iLate = h.indexOf('late_minutes');

  d.forEach(function (row) {
    const ds = (row[iDate] instanceof Date)
      ? Utilities.formatDate(row[iDate], 'Asia/Bangkok', 'yyyy-MM-dd')
      : String(row[iDate]);
    if (ds !== today) return;
    const emp = findEmployeeById_(row[iEmp]);
    workers.push({
      checkin_id: row[iId],
      employee_id: row[iEmp],
      display_name: emp ? emp.display_name : row[iEmp],
      nickname: emp ? (emp.nickname || '') : '',
      slot1_at: row[iSlot1] || '',
      scan_count: Number(row[iScan] || 0),
      status: row[iStatus] || 'pending',
      day_type: row[iDayType] || '',
      wage: Number(row[iWage] || 0),
      has_out_of_range: row[iOOR] === true,
      late_minutes: iLate >= 0 ? Number(row[iLate] || 0) : 0,
    });
  });
  return workers;
}

function replyTodayCommand_(ev) {
  const userId = ev.source && ev.source.userId;
  if (!isOwner(userId)) return replyText(ev.replyToken, 'เฉพาะเจ้าของเท่านั้น');

  const workers = getTodayWorkers_();
  if (workers.length === 0) {
    return replyText(ev.replyToken, 'วันนี้ยังไม่มีใครเช็คชื่อ');
  }
  const grace = Number(getConfig().late_grace_minutes) || 0;
  const lines = workers.map(function (w, i) {
    const t = w.slot1_at ? formatBangkokTimeOnly_(w.slot1_at) : '—';
    const late = w.late_minutes > grace ? ' ⏰สาย ' + w.late_minutes + 'น.' : '';
    const nick = w.nickname ? ' (' + w.nickname + ')' : '';
    const st = statusLabel_(w.status);
    return (i + 1) + '. ' + w.display_name + nick + '\n   เข้า ' + t + ' • สแกน ' +
      w.scan_count + '/4 • ' + st + late;
  });
  return replyText(ev.replyToken,
    '📋 วันนี้มาทำงาน ' + workers.length + ' คน\n\n' + lines.join('\n') +
    '\n\nพิมพ์ /endtoday เพื่อปิดวัน/สรุปค่าจ้าง');
}

function statusLabel_(s) {
  return { pending: 'รอตัดสิน', approved: 'สรุปแล้ว', absent: 'ไม่มาทำงาน', rejected: 'ไม่อนุมัติ' }[s] || s;
}

// ========================================================================
// /endtoday — เมนูปิดวัน (carousel)
// ========================================================================

function replyEndTodayCommand_(ev) {
  const userId = ev.source && ev.source.userId;
  if (!isOwner(userId)) return replyText(ev.replyToken, 'เฉพาะเจ้าของเท่านั้น');

  const workers = getTodayWorkers_();
  if (workers.length === 0) {
    return replyText(ev.replyToken, 'วันนี้ยังไม่มีใครเช็คชื่อ — ไม่มีอะไรให้ปิด');
  }
  const messages = buildEndTodayMessages_(workers);
  return replyMessage(ev.replyToken, messages.slice(0, 5));
}

/** cron 17:30 → push เมนูปิดวันหา owner ทุกคน */
function sendEndTodayMenu_() {
  const workers = getTodayWorkers_();
  if (workers.length === 0) return;
  const messages = buildEndTodayMessages_(workers);
  getConfig().OWNER_LINE_USER_IDS.forEach(function (uid) {
    pushMessage(uid, messages.slice(0, 5));
  });
}

/** carousel — chunk ละ 10 bubble */
function buildEndTodayMessages_(workers) {
  const grace = Number(getConfig().late_grace_minutes) || 0;
  const chunks = [];
  for (let i = 0; i < workers.length; i += 10) chunks.push(workers.slice(i, i + 10));
  return chunks.map(function (chunk) {
    return {
      type: 'flex',
      altText: 'ปิดวัน — ตัดสินค่าจ้าง ' + workers.length + ' คน',
      contents: { type: 'carousel', contents: chunk.map(function (w) { return buildEndTodayBubble_(w, grace); }) },
    };
  });
}

function buildEndTodayBubble_(w, grace) {
  const inTime = w.slot1_at ? formatBangkokTimeOnly_(w.slot1_at) : '—';
  const isLate = w.late_minutes > grace;
  const nick = w.nickname ? ' (' + w.nickname + ')' : '';
  const decided = (w.status === 'approved' || w.status === 'absent');

  const bodyContents = [
    { type: 'text', text: w.display_name + nick, weight: 'bold', size: 'md', wrap: true },
    { type: 'text', text: w.employee_id, size: 'xxs', color: '#6b7280' },
    { type: 'separator', margin: 'sm' },
    infoRow_('เข้างาน', inTime),
    infoRow_('สแกน', w.scan_count + '/4'),
    infoRow_('สถานะ', statusLabel_(w.status) + (decided ? ' • ' + Number(w.wage).toLocaleString() + '฿' : '')),
  ];
  if (isLate) {
    bodyContents.push({
      type: 'box', layout: 'vertical', margin: 'sm', paddingAll: '6px',
      backgroundColor: '#fef3c7', cornerRadius: '6px',
      contents: [{ type: 'text', text: '⏰ สาย ' + w.late_minutes + ' นาที', size: 'xs', color: '#d97706', weight: 'bold' }],
    });
  }
  if (w.has_out_of_range) {
    bodyContents.push({
      type: 'box', layout: 'vertical', margin: 'sm', paddingAll: '6px',
      backgroundColor: '#fef2f2', cornerRadius: '6px',
      contents: [{ type: 'text', text: 'นอกรัศมี', size: 'xs', color: '#9a0c24', weight: 'bold' }],
    });
  }

  const id = w.checkin_id;
  return {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#c8102e', paddingAll: '10px',
      contents: [{ type: 'text', text: 'ปิดวัน — เลือกค่าจ้าง', color: '#ffffff', weight: 'bold', size: 'sm' }],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: bodyContents },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'xs',
      contents: [
        { type: 'box', layout: 'horizontal', spacing: 'xs', contents: [
          smallBtn_('เต็มวัน', 'action=decide&id=' + id + '&type=full', '#c8102e'),
          smallBtn_('ครึ่งวัน', 'action=decide&id=' + id + '&type=half', '#9a0c24'),
        ]},
        { type: 'box', layout: 'horizontal', spacing: 'xs', contents: [
          smallBtn_('1ชม', 'action=decide&id=' + id + '&type=h1', '#6b7280'),
          smallBtn_('2ชม', 'action=decide&id=' + id + '&type=h2', '#6b7280'),
          smallBtn_('3ชม', 'action=decide&id=' + id + '&type=h3', '#6b7280'),
        ]},
        { type: 'box', layout: 'horizontal', spacing: 'xs', contents: [
          smallBtn_('ไม่มาทำงาน', 'action=absent&id=' + id, '#374151'),
          smallBtn_('เลิกจ้าง', 'action=terminate&emp=' + w.employee_id, '#991b1b'),
        ]},
      ],
    },
  };
}

function smallBtn_(label, data, color) {
  return {
    type: 'button', style: 'primary', color: color, height: 'sm', flex: 1,
    action: { type: 'postback', label: label, data: data, displayText: label },
  };
}
