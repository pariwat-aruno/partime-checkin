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
    'OWNER_LINE_USER_ID',
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

  // sheet `Config`
  Object.assign(cfg, readSheetConfig_(cfg.SHEET_ID));

  return cfg;
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
      const v = row[1];
      if (!k) return;
      // แปลงเป็น number ถ้าเป็นตัวเลข
      result[k] = (typeof v === 'number') ? v :
                  (!isNaN(parseFloat(v)) && isFinite(v)) ? Number(v) : v;
    });
  }

  // validate required
  const need = ['wage_full_day', 'wage_half_day', 'geofence_lat', 'geofence_lng', 'geofence_radius_m'];
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
