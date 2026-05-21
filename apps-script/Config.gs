/**
 * Config.gs — อ่านค่าตั้งระบบ (TASK-09)
 *
 * 2 แหล่ง:
 *   1) Script Properties — secret + ID (Sheet ID, LINE token, LIFF IDs ...)
 *   2) Sheet `Config` — ค่าจ้าง + พิกัด + รัศมี (เจ้าของแก้เองได้)
 *
 * cache 5 นาที กัน read sheet ซ้ำ
 */

const CONFIG_CACHE_KEY = 'partime_checkin_runtime_config';
const CONFIG_CACHE_TTL = 300; // 5 นาที

/**
 * คืนค่า config object รวมทุก property ที่ใช้บ่อย
 * required keys → ถ้าหายไป throw ทันที (fail fast)
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  const required = [
    'SHEET_ID',
    'DRIVE_FOLDER_ID',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LIFF_ID_REGISTER',
    'LIFF_ID_CHECKIN',
    'LIFF_ID_BALANCE',
  ];

  const cfg = {};
  const missing = [];
  required.forEach(function (key) {
    const v = props.getProperty(key);
    if (!v) missing.push(key);
    cfg[key] = v;
  });

  if (missing.length) {
    throw new Error('missing required Script Properties: ' + missing.join(', '));
  }

  // optional
  cfg.LINE_CHANNEL_SECRET = props.getProperty('LINE_CHANNEL_SECRET') || '';
  cfg.DRIVE_FOLDER_SELFIES = props.getProperty('DRIVE_FOLDER_SELFIES') || '';
  cfg.DRIVE_FOLDER_ID_CARDS = props.getProperty('DRIVE_FOLDER_ID_CARDS') || '';
  cfg.DRIVE_FOLDER_DAILY_CHECKINS = props.getProperty('DRIVE_FOLDER_DAILY_CHECKINS') || '';

  // sheet `Config` — wage, geofence, owner_line_user_ids
  Object.assign(cfg, readSheetConfig_(cfg.SHEET_ID));

  // owners — รองรับหลายคน
  // 1. ถ้ามี owner_line_user_ids ใน Sheet Config → ใช้ตัวนั้น (split ด้วย comma)
  // 2. ถ้าไม่มี → fall back ไปอ่าน OWNER_LINE_USER_ID จาก Script Properties (backward compat)
  let ownerIds = [];
  if (cfg.owner_line_user_ids) {
    ownerIds = String(cfg.owner_line_user_ids)
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  } else {
    const single = props.getProperty('OWNER_LINE_USER_ID');
    if (single) ownerIds = [single];
  }
  if (ownerIds.length === 0) {
    throw new Error('ไม่มี owner: เพิ่ม row owner_line_user_ids ใน sheet Config (comma-separated) หรือ Script Properties OWNER_LINE_USER_ID');
  }
  cfg.OWNER_LINE_USER_IDS = ownerIds;
  // backward compat — code เก่าที่ยังอ้างถึง OWNER_LINE_USER_ID = ตัวแรก
  cfg.OWNER_LINE_USER_ID = ownerIds[0];

  return cfg;
}

/** เช็คว่า userId เป็น owner คนใดคนหนึ่งไหม */
function isOwner(userId) {
  if (!userId) return false;
  try {
    const cfg = getConfig();
    return cfg.OWNER_LINE_USER_IDS.indexOf(userId) >= 0;
  } catch (e) {
    return false;
  }
}

/** push message ให้ owner ทุกคน */
function pushToAllOwners(messages) {
  const cfg = getConfig();
  cfg.OWNER_LINE_USER_IDS.forEach(function (uid) {
    pushMessage(uid, messages);
  });
}

/**
 * อ่านค่า wage / geofence จาก sheet Config (cache)
 * return: { wage_full_day, wage_half_day, geofence_lat, geofence_lng, geofence_radius_m }
 */
function readSheetConfig_(sheetId) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Config');
  if (!sh) throw new Error('sheet Config not found');

  const last = sh.getLastRow();
  const result = {};
  if (last >= 2) {
    const data = sh.getRange(2, 1, last - 1, 2).getValues();
    data.forEach(function (row) {
      const k = row[0];
      let v = row[1];
      if (!k) return;
      // Sheets auto-convert "08:00" → Date — format กลับเป็น HH:mm string
      if (v instanceof Date) {
        v = Utilities.formatDate(v, 'Asia/Bangkok', 'HH:mm');
      } else if (typeof v === 'number') {
        // keep
      } else if (typeof v === 'string' && !isNaN(parseFloat(v)) && isFinite(v)) {
        v = Number(v);
      }
      result[k] = v;
    });
  }

  // ค่าโมเดลคิดเงินใหม่ — ถ้ายังไม่ได้ seed ใน sheet ให้ fallback default (กันพังก่อน seed)
  if (result.wage_default == null)       result.wage_default = 400;
  if (result.late_grace_minutes == null) result.late_grace_minutes = 15;
  if (result.work_start_time == null)    result.work_start_time = '08:00';

  // validate required (owner_line_user_ids optional — fall back ไป Script Properties)
  const need = ['geofence_lat', 'geofence_lng', 'geofence_radius_m'];
  const miss = need.filter(function (k) { return result[k] == null; });
  if (miss.length) {
    throw new Error('missing keys in sheet Config: ' + miss.join(', '));
  }

  cache.put(CONFIG_CACHE_KEY, JSON.stringify(result), CONFIG_CACHE_TTL);
  return result;
}

/** invalidate cache (เรียกตอนเจ้าของแก้ค่าใน sheet) */
function clearConfigCache() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}
