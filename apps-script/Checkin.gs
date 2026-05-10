/**
 * Checkin.gs — flow B handler (TASK-16)
 *
 * input: { lineUserId, lat, lng, selfieBase64 }
 * output: { ok: true, checkinId, duplicated? } | { ok: false, error: '...' }
 *
 * เช็คตามลำดับ:
 *   1. มี employee จาก lineUserId ไหม
 *   2. is_active=TRUE ไหม
 *   3. อยู่ในรัศมี geofence ไหม (haversine)
 *   4. duplicate ของวันนี้ไหม → ถ้ามีคืนแถวเดิม
 *   5. upload selfie + insert row + push flex card หาเจ้าของ
 */

function checkin(payload) {
  if (!payload || !payload.lineUserId || payload.lat == null || payload.lng == null || !payload.selfieBase64) {
    return { ok: false, error: 'missing_fields' };
  }

  // 1. หา employee
  const emp = findEmployeeByLineUserId(payload.lineUserId);
  if (!emp) {
    return { ok: false, error: 'not_registered' };
  }

  // 2. is_active
  if (emp.is_active !== true && emp.is_active !== 'TRUE' && emp.is_active !== 'true') {
    return { ok: false, error: 'inactive' };
  }

  const cfg = getConfig();

  // 3. geofence
  const distance = Math.round(haversineMeters(
    Number(payload.lat), Number(payload.lng),
    Number(cfg.geofence_lat), Number(cfg.geofence_lng)
  ));
  if (distance > Number(cfg.geofence_radius_m)) {
    logInfo('checkin', 'out_of_range', { employeeId: emp.employee_id, distance: distance });
    return { ok: false, error: 'out_of_range', distanceM: distance };
  }

  // 4. duplicate วันเดียวกัน
  const today = todayBangkok();
  const existing = findCheckinForDate_(emp.employee_id, today);
  if (existing) {
    logInfo('checkin', 'duplicate', { employeeId: emp.employee_id, date: today });
    return { ok: true, checkinId: existing.checkin_id, duplicated: true };
  }

  // 5. upload selfie + insert + push flex
  const ts = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
  let selfieUrl;
  try {
    selfieUrl = uploadImage(payload.selfieBase64, 'checkin-' + emp.employee_id + '-' + ts + '.jpg', 'daily-checkins');
  } catch (err) {
    logError('checkin', 'upload failed: ' + err.message, { employeeId: emp.employee_id });
    return { ok: false, error: 'upload_failed', detail: err.message };
  }

  const checkinId = nextCheckinId(today);
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  // header: checkin_id, employee_id, checkin_date, checkin_at, lat, lng, distance_m, selfie_url, status, day_type, wage, approved_at
  sh.appendRow([
    checkinId,
    emp.employee_id,
    today,
    nowBangkok(),
    Number(payload.lat),
    Number(payload.lng),
    distance,
    selfieUrl,
    'pending',
    '',
    0,
    '',
  ]);

  logInfo('checkin', 'created', { checkinId: checkinId, employeeId: emp.employee_id, distance: distance });

  // ส่ง flex card หาเจ้าของ
  try {
    const card = buildApprovalCard({
      checkinId: checkinId,
      displayName: emp.display_name,
      phone: emp.phone,
      selfieUrl: selfieUrl,
      referenceSelfieUrl: emp.selfie_url,
      checkinAt: nowBangkok(),
      distanceM: distance,
    });
    pushMessage(cfg.OWNER_LINE_USER_ID, [card]);
  } catch (err) {
    logError('checkin', 'push flex failed: ' + err.message, { checkinId: checkinId });
  }

  return { ok: true, checkinId: checkinId };
}

/** หา checkin ของ employee_id + date — return row object หรือ null */
function findCheckinForDate_(employeeId, dateStr) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const idxEmp = headers.indexOf('employee_id');
  const idxDate = headers.indexOf('checkin_date');

  for (let i = 0; i < data.length; i++) {
    const d = data[i][idxDate];
    const dStr = (d instanceof Date)
      ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd')
      : String(d);
    if (data[i][idxEmp] === employeeId && dStr === dateStr) {
      const row = {};
      headers.forEach(function (h, j) { row[h] = data[i][j]; });
      row._rowNumber = i + 2;
      return row;
    }
  }
  return null;
}
