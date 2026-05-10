/**
 * Reminder.gs — แจ้งเตือนพนักงานอัตโนมัติ
 *
 * 1. แต่ละ slot — ถ้าผ่าน slot_expected ไป +10 และ +20 นาที ยังไม่สแกน
 *    → push text หาคนที่ยังไม่สแกน slot นั้น
 * 2. ที่ slot4_expected (17:00 default) — broadcast end-of-work
 *    หา ALL active employees แจ้งให้เลิกงาน + คำเตือน OT
 *
 * setup: รัน setupReminderTrigger() ครั้งเดียวใน Apps Script editor
 *        จะสร้าง time-driven trigger รัน tickReminders() ทุก 5 นาที
 *
 * dedup: ใช้ PropertiesService key "reminder_state" เก็บว่าวันนี้ยิงอะไรไปบ้าง
 *        (reset อัตโนมัติเมื่อขึ้นวันใหม่)
 */

function setupReminderTrigger() {
  // ลบ trigger เดิม (กัน duplicate)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tickReminders').timeBased().everyMinutes(5).create();
  Logger.log('สร้าง trigger tickReminders ทุก 5 นาทีเรียบร้อย');
  Logger.log('reset reminder_state');
  PropertiesService.getScriptProperties().deleteProperty('reminder_state');
}

function deleteReminderTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickReminders') {
      ScriptApp.deleteTrigger(t); n++;
    }
  });
  Logger.log('ลบ trigger ' + n + ' ตัว');
}

/** ทดสอบทันที — เรียกได้จาก editor เพื่อทดสอบโดยไม่รอ trigger */
function testTickReminders() {
  tickReminders();
}

/** ส่ง reminder slot 1 ทันที — bypass time check (สำหรับทดสอบ) */
function testSendSlotReminderSlot1() {
  const cfg = getConfig();
  sendSlotReminder_(cfg, 1, todayBangkok(), 1);
  Logger.log('ส่ง slot 1 reminder round 1 เรียบร้อย ดู LINE chat');
}
function testSendSlotReminderSlot2() {
  const cfg = getConfig();
  sendSlotReminder_(cfg, 2, todayBangkok(), 1);
}
function testSendSlotReminderSlot3() {
  const cfg = getConfig();
  sendSlotReminder_(cfg, 3, todayBangkok(), 1);
}
function testSendSlotReminderSlot4() {
  const cfg = getConfig();
  sendSlotReminder_(cfg, 4, todayBangkok(), 1);
}

/** ส่ง broadcast เลิกงานทันที — bypass time check */
function testSendEndOfWork() {
  sendEndOfWorkBroadcast_();
  Logger.log('ส่ง end-of-work broadcast เรียบร้อย ดู LINE chat ของ active employees');
}

function tickReminders() {
  try {
    const cfg = getConfig();
    const today = todayBangkok();
    const hhmm = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm');
    const state = loadReminderState_(today);

    // 4 slots — เตือนที่ +10 และ +20 นาทีหลัง expected
    for (let s = 1; s <= 4; s++) {
      const expected = cfg['slot' + s + '_expected'];
      if (!expected) continue;
      const r1 = addMinutes_(expected, 10);
      const r2 = addMinutes_(expected, 20);

      // ±3 นาที window (กัน trigger lag) + dedup ผ่าน state.sent
      if (state.sent.indexOf('s' + s + 'r1') < 0 && hhmmInWindow_(hhmm, r1, 3)) {
        sendSlotReminder_(cfg, s, today, 1);
        state.sent.push('s' + s + 'r1'); saveReminderState_(state);
      }
      if (state.sent.indexOf('s' + s + 'r2') < 0 && hhmmInWindow_(hhmm, r2, 3)) {
        sendSlotReminder_(cfg, s, today, 2);
        state.sent.push('s' + s + 'r2'); saveReminderState_(state);
      }
    }

    // end-of-work broadcast — ที่ slot4_expected (17:00 default)
    const eod = cfg.slot4_expected || '17:00';
    if (state.sent.indexOf('eod') < 0 && hhmmInWindow_(hhmm, eod, 3)) {
      sendEndOfWorkBroadcast_();
      state.sent.push('eod'); saveReminderState_(state);
    }
  } catch (err) {
    logError('tickReminders', err.message, '');
  }
}

function loadReminderState_(today) {
  const raw = PropertiesService.getScriptProperties().getProperty('reminder_state');
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj.date === today) return obj;
    } catch (e) {}
  }
  return { date: today, sent: [] };
}

function saveReminderState_(state) {
  PropertiesService.getScriptProperties().setProperty('reminder_state', JSON.stringify(state));
}

/** force-convert input → 'HH:mm' string (รับ Date จาก Sheet ได้) */
function toHHmm_(x) {
  if (x == null) return '';
  if (x instanceof Date) return Utilities.formatDate(x, 'Asia/Bangkok', 'HH:mm');
  return String(x).trim();
}

function addMinutes_(hhmm, mins) {
  const parts = toHHmm_(hhmm).split(':');
  if (parts.length < 2) return '';
  let total = Number(parts[0]) * 60 + Number(parts[1]) + mins;
  if (isNaN(total)) return '';
  if (total < 0) total += 24 * 60;
  if (total >= 24 * 60) total -= 24 * 60;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' +
         String(total % 60).padStart(2, '0');
}

function hhmmInWindow_(now, target, windowMin) {
  const toMin = function (x) {
    const p = toHHmm_(x).split(':');
    if (p.length < 2) return NaN;
    return Number(p[0]) * 60 + Number(p[1]);
  };
  const a = toMin(now), b = toMin(target);
  if (isNaN(a) || isNaN(b)) return false;
  return Math.abs(a - b) <= windowMin;
}

/**
 * ส่ง reminder slot N หา active employees ที่ยังไม่สแกน slot นั้นวันนี้
 * round 1 = ครั้งแรก (+10), round 2 = ครั้งสุดท้าย (+20)
 */
function sendSlotReminder_(cfg, slot, today, round) {
  const slotLabel = getSlotLabel(cfg, slot);
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const empSh = ss.getSheetByName('Employees');
  const checkSh = ss.getSheetByName('Checkins');

  // active employees
  const actives = [];
  if (empSh.getLastRow() >= 2) {
    const eh = empSh.getRange(1, 1, 1, empSh.getLastColumn()).getValues()[0];
    const ed = empSh.getRange(2, 1, empSh.getLastRow() - 1, empSh.getLastColumn()).getValues();
    const iId = eh.indexOf('employee_id');
    const iLine = eh.indexOf('line_user_id');
    const iName = eh.indexOf('display_name');
    const iActive = eh.indexOf('is_active');
    ed.forEach(function (row) {
      if (row[iActive] === true || String(row[iActive]).toLowerCase() === 'true') {
        actives.push({ id: row[iId], userId: row[iLine], name: row[iName] });
      }
    });
  }

  // คนที่สแกน slot นี้แล้ววันนี้
  const scanned = {};
  if (checkSh.getLastRow() >= 2) {
    const ch = checkSh.getRange(1, 1, 1, checkSh.getLastColumn()).getValues()[0];
    const cd = checkSh.getRange(2, 1, checkSh.getLastRow() - 1, checkSh.getLastColumn()).getValues();
    const iEmp = ch.indexOf('employee_id');
    const iDate = ch.indexOf('checkin_date');
    const iSlotAt = ch.indexOf('slot' + slot + '_at');
    cd.forEach(function (row) {
      const d = row[iDate];
      const dStr = (d instanceof Date)
        ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd')
        : String(d);
      if (dStr === today && row[iSlotAt]) scanned[row[iEmp]] = true;
    });
  }

  // text per employee — มีชื่อพนักงาน
  const lastTag = round === 2 ? 'ครั้งสุดท้าย' : '';

  let sent = 0;
  actives.forEach(function (a) {
    if (scanned[a.id]) return;
    if (!a.userId) return;
    if (isOwner(a.userId)) return;  // ห้ามส่งหา owner
    const message =
      'แจ้งเตือน' + lastTag + 'จาก บริษัทฯ ถึง คุณ ' + (a.name || a.id) + '\n\n' +
      'กรุณาสแกนหน้าในรอบ ' + slotLabel + ' ภายใน 10 นาที\n\n' +
      'บริษัท วอร์ด้า สกินแคร์ จำกัด';
    pushText(a.userId, message);
    sent++;
  });
  logInfo('sendSlotReminder', 'slot=' + slot + ' round=' + round + ' sent=' + sent, '');
}

/** broadcast เลิกงาน — push flex card สีเหลืองหา active employees (ยกเว้น owner) */
function sendEndOfWorkBroadcast_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const empSh = SpreadsheetApp.openById(sheetId).getSheetByName('Employees');
  if (empSh.getLastRow() < 2) return;
  const eh = empSh.getRange(1, 1, 1, empSh.getLastColumn()).getValues()[0];
  const ed = empSh.getRange(2, 1, empSh.getLastRow() - 1, empSh.getLastColumn()).getValues();
  const iLine = eh.indexOf('line_user_id');
  const iActive = eh.indexOf('is_active');

  const card = buildEndOfWorkCard();

  let sent = 0;
  ed.forEach(function (row) {
    if (row[iActive] === true || String(row[iActive]).toLowerCase() === 'true') {
      const uid = row[iLine];
      if (!uid) return;
      if (isOwner(uid)) return;  // ห้ามส่งหา owner
      pushMessage(uid, [card]);
      sent++;
    }
  });
  logInfo('sendEndOfWorkBroadcast', 'sent=' + sent, '');
}
