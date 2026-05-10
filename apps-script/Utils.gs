/**
 * Utils.gs — helper พื้นฐาน (TASK-11)
 *
 * - haversineMeters: ระยะ GPS เป็นเมตร
 * - nowBangkok: ISO 8601 + offset +07:00
 * - nextEmployeeId / nextCheckinId / nextPaymentId: gen running ID
 */

/**
 * ระยะ GPS เป็นเมตร — สูตร haversine
 *
 * test:
 *   haversineMeters(13.7563, 100.5018, 13.7563, 100.5018) === 0
 *   haversineMeters(13.7563, 100.5018, 13.7600, 100.5018) ≈ 411
 *   haversineMeters(13.7563, 100.5018, 13.7563, 100.5060) ≈ 454
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // รัศมีโลก (เมตร)
  const toRad = function (deg) { return deg * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** ปัจจุบันใน Asia/Bangkok ISO 8601 — '2026-05-09T15:30:45+07:00' */
function nowBangkok() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** วันที่ปัจจุบันใน Asia/Bangkok format yyyy-MM-dd */
function todayBangkok() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

/** เดือนปัจจุบัน format yyyy-MM */
function thisMonthBangkok() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
}

/**
 * gen employee_id ถัดไป — `EMP-XXXX` 4 หลัก
 * นับจากจำนวนแถวใน sheet Employees
 */
function nextEmployeeId() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Employees');
  const next = sh.getLastRow(); // header = row 1, ของเก่า n = lastRow - 1, ถัดไป = lastRow
  return 'EMP-' + padLeft_(next, 4);
}

/**
 * gen checkin_id — `CHK-YYYYMMDD-XXXX`
 * XXXX = running ของวันเดียวกัน (นับจาก sheet Checkins)
 */
function nextCheckinId(dateStr) {
  // dateStr รูปแบบ yyyy-MM-dd
  const ymd = dateStr.replace(/-/g, '');
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  const last = sh.getLastRow();
  let count = 0;
  if (last >= 2) {
    const dates = sh.getRange(2, 3, last - 1, 1).getValues(); // col C = checkin_date
    dates.forEach(function (row) {
      const d = row[0];
      let s;
      if (d instanceof Date) {
        s = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
      } else {
        s = String(d);
      }
      if (s === dateStr) count++;
    });
  }
  return 'CHK-' + ymd + '-' + padLeft_(count + 1, 4);
}

/**
 * gen payment_id — `PAY-YYYYMM-XXXX`
 * XXXX = running ของ period เดียวกัน
 */
function nextPaymentId(period) {
  // period รูปแบบ yyyy-MM (อาจมี suffix เช่น 2026-05-resign)
  const ym = period.split('-').slice(0, 2).join('');
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Payments');
  const last = sh.getLastRow();
  let count = 0;
  if (last >= 2) {
    const periods = sh.getRange(2, 3, last - 1, 1).getValues(); // col C = period
    periods.forEach(function (row) {
      // เริ่มต้นด้วย period เช่น "2026-05" หรือ "2026-05-resign"
      if (String(row[0]).startsWith(period.split('-').slice(0, 2).join('-'))) count++;
    });
  }
  return 'PAY-' + ym + '-' + padLeft_(count + 1, 4);
}

function padLeft_(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/**
 * คำนวณ slot ปัจจุบัน (1-4) จากเวลา Asia/Bangkok + Sheet Config
 * < slot1_until → 1, < slot2_until → 2, < slot3_until → 3, อื่น ๆ → 4
 */
function getCurrentSlot(cfg) {
  const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm');
  if (now < (cfg.slot1_until || '11:00')) return 1;
  if (now < (cfg.slot2_until || '13:00')) return 2;
  if (now < (cfg.slot3_until || '17:00')) return 3;
  return 4;
}

/** label ของ slot — เอามาจาก Sheet Config (slot1_label / slot2_label / ...) */
function getSlotLabel(cfg, slot) {
  const fallback = ['', 'เช้า', 'ก่อนพักเที่ยง', 'บ่ายโมง', 'เลิกงาน'];
  return cfg['slot' + slot + '_label'] || fallback[slot] || ('slot ' + slot);
}

/** format วันที่+เวลาเป็นไทยอ่านง่าย: "10 พ.ค. 2026 เวลา 17:05 น." */
function formatThaiDateTime(d) {
  d = d || new Date();
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const day = Utilities.formatDate(d, 'Asia/Bangkok', 'd');
  const monthIdx = Number(Utilities.formatDate(d, 'Asia/Bangkok', 'M')) - 1;
  const year = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy');
  const time = Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm');
  return day + ' ' + months[monthIdx] + ' ' + year + ' เวลา ' + time + ' น.';
}

/** หา employee จาก line_user_id — return row object หรือ null */
function findEmployeeByLineUserId(lineUserId) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Employees');
  const last = sh.getLastRow();
  if (last < 2) return null;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idxLineUserId = headers.indexOf('line_user_id');
  if (idxLineUserId < 0) throw new Error('column line_user_id not found in Employees');

  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][idxLineUserId] === lineUserId) {
      const row = {};
      headers.forEach(function (h, j) { row[h] = data[i][j]; });
      row._rowNumber = i + 2;
      return row;
    }
  }
  return null;
}
