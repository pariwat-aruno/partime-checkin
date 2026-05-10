/**
 * Checkin.gs — flow B handler — 4-slot per day
 *
 * input: { lineUserId, lat, lng, selfieBase64, slot? }
 *   slot: 1-4 (เช้า/ก่อนเที่ยง/บ่ายโมง/เลิกงาน) — ถ้าไม่ส่งมา auto-detect จากเวลา
 *
 * output: {
 *   ok: true,
 *   checkinId,
 *   slot,
 *   slotLabel,
 *   scanCount,        // 0-4 (รวม slot นี้แล้ว)
 *   alreadyScanned,   // true ถ้า slot นี้สแกนไปแล้ววันนี้
 *   outOfRange,
 *   distanceM,
 *   completed,        // true เมื่อสแกนครบ 4 → push flex หาเจ้าของ
 * }
 *
 * เช็คตามลำดับ:
 *   1. มี employee + active
 *   2. คำนวณ slot (จาก payload หรือ auto)
 *   3. หา/สร้างแถวของวันนี้ (1 row = 1 employee 1 day)
 *   4. ถ้า slot นี้สแกนแล้ว → return alreadyScanned (ไม่ overwrite)
 *   5. upload selfie → update slot N + last_lat/lng/distance + scan_count
 *   6. ถ้า scan_count == 4 → push flex card หาเจ้าของพร้อมรูป 4 ใบ
 */

function checkin(payload) {
  if (!payload || !payload.lineUserId || payload.lat == null || payload.lng == null || !payload.selfieBase64) {
    return { ok: false, error: 'missing_fields' };
  }

  const emp = findEmployeeByLineUserId(payload.lineUserId);
  if (!emp) return { ok: false, error: 'not_registered' };
  if (emp.is_active !== true && String(emp.is_active).toLowerCase() !== 'true') {
    return { ok: false, error: 'inactive' };
  }

  const cfg = getConfig();
  const slot = (payload.slot >= 1 && payload.slot <= 4) ? Number(payload.slot) : getCurrentSlot(cfg);
  const slotLabel = getSlotLabel(cfg, slot);

  // distance (ส่วน global ของวัน — เก็บ last_*)
  const distance = Math.round(haversineMeters(
    Number(payload.lat), Number(payload.lng),
    Number(cfg.geofence_lat), Number(cfg.geofence_lng)
  ));
  const slotOutOfRange = distance > Number(cfg.geofence_radius_m);

  // หา / สร้างแถวของวันนี้
  const today = todayBangkok();
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const colIdx = {};
  headers.forEach(function (h, i) { colIdx[h] = i + 1; }); // 1-based

  let rowNum = findCheckinRowForDate_(sh, headers, emp.employee_id, today);
  let scanCount = 0;

  if (rowNum > 0) {
    // มีแถววันนี้แล้ว
    const slotAtCol = colIdx['slot' + slot + '_at'];
    const existing = sh.getRange(rowNum, slotAtCol).getValue();
    if (existing) {
      // slot นี้สแกนไปแล้ว — ไม่ overwrite
      const existingScanCount = Number(sh.getRange(rowNum, colIdx['scan_count']).getValue() || 0);
      const existingCheckinId = sh.getRange(rowNum, colIdx['checkin_id']).getValue();
      logInfo('checkin', 'slot already scanned', { employeeId: emp.employee_id, slot: slot, date: today });
      return {
        ok: true,
        checkinId: existingCheckinId,
        slot: slot,
        slotLabel: slotLabel,
        scanCount: existingScanCount,
        alreadyScanned: true,
      };
    }
    scanCount = Number(sh.getRange(rowNum, colIdx['scan_count']).getValue() || 0);
  } else {
    // สร้างแถวใหม่
    const newCheckinId = nextCheckinId(today);
    const newRow = new Array(headers.length).fill('');
    newRow[colIdx['checkin_id'] - 1] = newCheckinId;
    newRow[colIdx['employee_id'] - 1] = emp.employee_id;
    newRow[colIdx['checkin_date'] - 1] = today;
    newRow[colIdx['scan_count'] - 1] = 0;
    newRow[colIdx['has_out_of_range'] - 1] = false;
    newRow[colIdx['status'] - 1] = 'pending';
    newRow[colIdx['day_type'] - 1] = '';
    newRow[colIdx['wage'] - 1] = 0;
    sh.appendRow(newRow);
    rowNum = sh.getLastRow();
  }

  // upload selfie
  const ts = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
  let selfieUrl;
  try {
    selfieUrl = uploadImage(payload.selfieBase64,
      'checkin-' + emp.employee_id + '-' + today + '-slot' + slot + '-' + ts + '.jpg',
      'daily-checkins');
  } catch (err) {
    logError('checkin', 'upload failed: ' + err.message, { employeeId: emp.employee_id, slot: slot });
    return { ok: false, error: 'upload_failed', detail: err.message };
  }

  // update slot N + last_* + scan_count + has_out_of_range
  sh.getRange(rowNum, colIdx['slot' + slot + '_at']).setValue(nowBangkok());
  sh.getRange(rowNum, colIdx['slot' + slot + '_url']).setValue(selfieUrl);
  sh.getRange(rowNum, colIdx['last_lat']).setValue(Number(payload.lat));
  sh.getRange(rowNum, colIdx['last_lng']).setValue(Number(payload.lng));
  sh.getRange(rowNum, colIdx['last_distance_m']).setValue(distance);

  const newScanCount = scanCount + 1;
  sh.getRange(rowNum, colIdx['scan_count']).setValue(newScanCount);

  if (slotOutOfRange) {
    sh.getRange(rowNum, colIdx['has_out_of_range']).setValue(true);
  }

  logInfo('checkin', 'slot recorded', {
    employeeId: emp.employee_id, slot: slot, scanCount: newScanCount,
    distance: distance, outOfRange: slotOutOfRange,
  });

  // push flex หาเจ้าของเฉพาะตอนสแกนครบ 4 (กันสแปม)
  let completed = false;
  if (newScanCount === 4) {
    completed = true;
    try {
      const slots = collectSlotsFromRow_(sh, rowNum, colIdx, cfg);
      const hasOutOfRange = sh.getRange(rowNum, colIdx['has_out_of_range']).getValue() === true;
      const checkinId = sh.getRange(rowNum, colIdx['checkin_id']).getValue();
      const card = buildApprovalCard({
        checkinId: checkinId,
        displayName: emp.display_name,
        phone: emp.phone,
        date: today,
        slots: slots,
        referenceSelfieUrl: emp.selfie_url,
        lastDistanceM: distance,
        radiusM: Number(cfg.geofence_radius_m),
        hasOutOfRange: hasOutOfRange,
        scanCount: newScanCount,
      });
      pushToAllOwners([card]);
    } catch (err) {
      logError('checkin', 'push flex failed: ' + err.message, { rowNum: rowNum });
    }
  }

  return {
    ok: true,
    checkinId: sh.getRange(rowNum, colIdx['checkin_id']).getValue(),
    slot: slot,
    slotLabel: slotLabel,
    scanCount: newScanCount,
    distanceM: distance,
    outOfRange: slotOutOfRange,
    completed: completed,
  };
}

/** หา rowNum ของ employee + วันที่ ใน Checkins — return 0 ถ้าไม่เจอ */
function findCheckinRowForDate_(sh, headers, employeeId, dateStr) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const iEmp = headers.indexOf('employee_id');
  const iDate = headers.indexOf('checkin_date');
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < data.length; i++) {
    const d = data[i][iDate];
    const dStr = (d instanceof Date)
      ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd')
      : String(d);
    if (data[i][iEmp] === employeeId && dStr === dateStr) {
      return i + 2;
    }
  }
  return 0;
}

/** อ่าน 4 slot จากแถว → array of {slot, label, at, url, completed} */
function collectSlotsFromRow_(sh, rowNum, colIdx, cfg) {
  const slots = [];
  for (let s = 1; s <= 4; s++) {
    const at = sh.getRange(rowNum, colIdx['slot' + s + '_at']).getValue();
    const url = sh.getRange(rowNum, colIdx['slot' + s + '_url']).getValue();
    slots.push({
      slot: s,
      label: getSlotLabel(cfg, s),
      at: at || '',
      url: url || '',
      completed: !!at,
    });
  }
  return slots;
}

/** อ่าน Checkins row ตาม checkin_id → return data + headers (ใช้ใน FlexCard rebuild ตอน "รอ") */
function readCheckinById_(checkinId) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iId = headers.indexOf('checkin_id');
  for (let i = 0; i < data.length; i++) {
    if (data[i][iId] === checkinId) {
      const row = {};
      headers.forEach(function (h, j) { row[h] = data[i][j]; });
      row._rowNumber = i + 2;
      return row;
    }
  }
  return null;
}

/** GET สถานะวันนี้ของ employee (ใช้โดย LIFF เพื่อโชว์ slot status) */
function getTodayStatus(payload) {
  if (!payload || !payload.lineUserId) return { ok: false, error: 'missing_fields' };
  const emp = findEmployeeByLineUserId(payload.lineUserId);
  if (!emp) return { ok: false, error: 'not_registered' };
  if (emp.is_active !== true && String(emp.is_active).toLowerCase() !== 'true') {
    return { ok: false, error: 'inactive' };
  }
  const cfg = getConfig();
  const today = todayBangkok();
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const colIdx = {};
  headers.forEach(function (h, i) { colIdx[h] = i + 1; });

  const rowNum = findCheckinRowForDate_(sh, headers, emp.employee_id, today);
  const slotsStatus = [1, 2, 3, 4].map(function (s) {
    const completed = rowNum > 0
      ? !!sh.getRange(rowNum, colIdx['slot' + s + '_at']).getValue()
      : false;
    return { slot: s, label: getSlotLabel(cfg, s), completed: completed };
  });

  return {
    ok: true,
    employeeId: emp.employee_id,
    displayName: emp.display_name,
    date: today,
    currentSlot: getCurrentSlot(cfg),
    currentSlotLabel: getSlotLabel(cfg, getCurrentSlot(cfg)),
    slots: slotsStatus,
    scanCount: slotsStatus.filter(function (s) { return s.completed; }).length,
  };
}
