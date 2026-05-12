/**
 * OwnerLog.gs — บันทึก action ของเจ้าของลง sheet `OwnerLogs`
 *
 * ใช้สำหรับ audit trail ว่า owner คนไหนกดทำอะไร เมื่อไหร่
 *
 * schema (sheet OwnerLogs):
 *   timestamp | owner_user_id | owner_name | action | target_id | target_name | detail
 *
 * usage:
 *   logOwnerAction(ownerLineUserId, 'approve_full', checkinId, employeeName, { wage: 400 });
 *   logOwnerAction(ownerLineUserId, 'close_period', paymentId, employeeName, { period: '2026-05', total: 5200 });
 *
 * action codes (มาตรฐาน):
 *   - approve_full / approve_half / reject   (Checkins)
 *   - close_period / mark_paid               (Payments)
 */

function logOwnerAction(ownerUserId, action, targetId, targetName, detail) {
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!sheetId) {
      console.error('SHEET_ID not set — cannot log owner action');
      return;
    }
    const ss = SpreadsheetApp.openById(sheetId);
    let sh = ss.getSheetByName('OwnerLogs');
    if (!sh) {
      // auto-create กรณียังไม่ได้รัน setupDatabase ใหม่
      sh = ss.insertSheet('OwnerLogs');
      const headers = ['timestamp', 'owner_user_id', 'owner_name', 'action', 'target_id', 'target_name', 'detail'];
      sh.getRange(1, 1, 1, headers.length)
        .setValues([headers])
        .setFontWeight('bold')
        .setBackground('#f0f0f0');
      sh.setFrozenRows(1);
    }
    sh.appendRow([
      nowBangkok(),
      String(ownerUserId || ''),
      getOwnerDisplayName_(ownerUserId),
      String(action || ''),
      String(targetId || ''),
      String(targetName || ''),
      detail == null ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
    ]);
  } catch (err) {
    // log ไม่ได้ห้าม throw — กัน action จริงล้ม
    console.error('logOwnerAction failed:', err && err.message ? err.message : err);
  }
}

/**
 * ดึง display name ของ owner จาก LINE Profile API
 * cache ไว้ใน Script Cache 6 ชั่วโมง — ลด API call
 */
function getOwnerDisplayName_(userId) {
  if (!userId) return '';
  const cache = CacheService.getScriptCache();
  const key = 'owner_name_' + userId;
  const cached = cache.get(key);
  if (cached) return cached;

  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return userId;

  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return userId;
    const profile = JSON.parse(res.getContentText());
    const name = profile.displayName || userId;
    cache.put(key, name, 21600); // 6 ชม.
    return name;
  } catch (err) {
    console.error('getOwnerDisplayName_ failed:', err && err.message ? err.message : err);
    return userId;
  }
}

/**
 * list owner log ล่าสุด — สำหรับ Admin LIFF view
 *
 * input:  { lineUserId, limit? }   limit default 50, max 200
 * output: { ok, items: [{timestamp, owner_user_id, owner_name, action, target_id, target_name, detail}] }
 *
 * เรียงจากใหม่ → เก่า
 */
function getOwnerLogs(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const limit = Math.min(Number((payload && payload.limit) || 50), 200);

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('OwnerLogs');
  if (!sh) return { ok: true, items: [] };

  const last = sh.getLastRow();
  if (last < 2) return { ok: true, items: [] };

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const startRow = Math.max(2, last - limit + 1);
  const count = last - startRow + 1;
  const data = sh.getRange(startRow, 1, count, sh.getLastColumn()).getValues();

  const items = data.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    // normalize timestamp ให้เป็น string เสมอ
    if (obj.timestamp instanceof Date) {
      obj.timestamp = Utilities.formatDate(obj.timestamp, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX");
    } else {
      obj.timestamp = String(obj.timestamp || '');
    }
    return obj;
  });
  // ใหม่ → เก่า
  items.reverse();

  return { ok: true, items: items };
}
