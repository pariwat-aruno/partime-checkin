/**
 * Setup.gs — One-time setup ของ partime-checkin
 *
 * วิธีใช้ (TASK-01):
 * 1. ไป https://script.google.com → New project
 * 2. แปะไฟล์นี้ลง editor
 * 3. กด Run บน function `setupDatabase`
 * 4. อนุญาต permission (Drive + Sheets)
 * 5. เปิด View → Logs → copy SHEET_ID ไปใส่ Script Properties (TASK-08)
 *
 * อ้างอิง: CONTEXT.md § 4 Data Model
 */

// ชื่อ spreadsheet
const DB_NAME = 'partime-checkin-db';

// header ของแต่ละ sheet — ลำดับสำคัญ ห้ามสลับ
const SHEET_HEADERS = {
  Employees: [
    'employee_id',
    'line_user_id',
    'display_name',
    'phone',
    'bank_name',
    'bank_account_no',
    'bank_account_name',
    'selfie_url',
    'id_card_url',
    'is_active',
    'registered_at',
  ],
  Checkins: [
    'checkin_id',
    'employee_id',
    'checkin_date',
    'slot1_at',         // เช้า
    'slot1_url',
    'slot2_at',         // ก่อนพักเที่ยง
    'slot2_url',
    'slot3_at',         // บ่ายโมง
    'slot3_url',
    'slot4_at',         // เลิกงาน
    'slot4_url',
    'last_lat',
    'last_lng',
    'last_distance_m',
    'has_out_of_range',
    'scan_count',
    'status',
    'day_type',
    'wage',
    'approved_at',
  ],
  Payments: [
    'payment_id',
    'employee_id',
    'period',
    'total_days_full',
    'total_days_half',
    'total_amount',
    'status',
    'closed_at',
    'paid_at',
    'note',
  ],
  Logs: ['timestamp', 'level', 'function', 'message', 'payload'],
  Config: ['key', 'value'],
};

/**
 * สร้าง Sheet ใหม่ + 5 tab พร้อม header
 * idempotent: รันซ้ำได้ ถ้าเจอชื่อเดิมแล้วจะไม่สร้างใหม่ (ดูจาก DriveApp)
 */
function setupDatabase() {
  // กัน double create — ถ้ามีไฟล์ชื่อเดียวกันใน Drive ของเจ้าของอยู่แล้วให้ใช้ตัวเดิม
  const existing = DriveApp.getFilesByName(DB_NAME);
  let ss;
  if (existing.hasNext()) {
    const file = existing.next();
    ss = SpreadsheetApp.openById(file.getId());
    Logger.log('พบไฟล์เดิม — ใช้ตัวเดิม id=%s', ss.getId());
  } else {
    ss = SpreadsheetApp.create(DB_NAME);
    Logger.log('สร้างใหม่ id=%s', ss.getId());
  }

  // สร้าง 5 sheet ตาม SHEET_HEADERS
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    ensureSheetWithHeaders_(ss, name, SHEET_HEADERS[name]);
  });

  // ลบ Sheet1 ทิ้ง (default ที่ติดมาตอน create)
  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1) {
    ss.deleteSheet(sheet1);
  }

  // log สรุป
  Logger.log('=========================================');
  Logger.log('SHEET_ID = %s', ss.getId());
  Logger.log('URL      = %s', ss.getUrl());
  Logger.log('=========================================');
  Logger.log('copy SHEET_ID ไปใส่ Script Properties (TASK-08)');

  return { sheetId: ss.getId(), url: ss.getUrl() };
}

/**
 * สร้าง sheet (ถ้ายังไม่มี) แล้วใส่ header + freeze + bold
 * ถ้ามี sheet อยู่แล้วจะ verify header ตรงกัน — ถ้าไม่ตรง throw
 */
function ensureSheetWithHeaders_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }

  const range = sh.getRange(1, 1, 1, headers.length);
  const current = range.getValues()[0];

  // ถ้า header ว่างทั้งแถว → เขียนใหม่
  const isEmpty = current.every(function (c) {
    return c === '' || c === null;
  });

  if (isEmpty) {
    range.setValues([headers]);
    range.setFontWeight('bold');
    range.setBackground('#f0f0f0');
    sh.setFrozenRows(1);
    Logger.log('  [%s] เพิ่ม header %d column', name, headers.length);
  } else {
    // verify header เดิมตรงกับสเปก
    const mismatch = headers.some(function (h, i) {
      return current[i] !== h;
    });
    if (mismatch) {
      throw new Error(
        'Sheet "' + name + '" มี header แต่ไม่ตรงสเปก — expect [' + headers.join(',') +
        '] got [' + current.join(',') + ']'
      );
    }
    Logger.log('  [%s] header ครบแล้ว — ข้าม', name);
  }

  // ปรับ column width พอดูสบายตา (ครั้งแรกเท่านั้น)
  if (isEmpty) {
    sh.autoResizeColumns(1, headers.length);
  }
}

// ========================================================================
// TASK-02 — seed ค่าเริ่มต้นใน sheet Config
// ========================================================================

// ค่า default ของระบบ — แก้ตรงนี้ถ้าจะเปลี่ยนค่าจ้าง/พิกัด/รัศมี/owners/slot
const CONFIG_DEFAULTS = {
  wage_full_day: 400,
  wage_half_day: 200,
  geofence_lat: 18.82895270346188,
  geofence_lng: 99.01300963558201,
  geofence_radius_m: 100,
  // owner_line_user_ids: comma-separated เช่น 'U1234,U5678' (เพิ่ม owner ใหม่ที่นี่)
  owner_line_user_ids: 'U4b33c5ea9673d07f3e275efaa4db02a2',
  // ช่วงเวลา 4 slot — auto-detect จากเวลาปัจจุบัน (HH:mm)
  // < slot1_until → slot 1, < slot2_until → slot 2, ฯลฯ, สูงกว่า slot3_until = slot 4
  slot1_until: '11:00',
  slot2_until: '13:00',
  slot3_until: '17:00',
  slot1_label: 'เช้า',
  slot2_label: 'ก่อนพักเที่ยง',
  slot3_label: 'บ่ายโมง',
  slot4_label: 'เลิกงาน',
  // เวลาที่ระบบคาดหวังให้สแกน — ใช้คำนวณ reminder (เตือนที่ +10 และ +20 นาที)
  slot1_expected: '08:00',
  slot2_expected: '12:00',
  slot3_expected: '13:00',
  slot4_expected: '17:00',  // = เวลาเลิกงาน + broadcast end-of-work
};

/**
 * เขียนค่า default ลง sheet Config
 * idempotent: รันซ้ำได้ — ถ้า key เดิมมีอยู่แล้วจะ update ค่า, ไม่งั้น append
 *
 * วิธีใช้:
 * 1. แก้ค่าใน CONFIG_DEFAULTS ด้านบน (ถ้าต้องการ)
 * 2. กด Run บน function `seedConfig`
 */
function seedConfig() {
  const sheetId = findSheetId_();
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName('Config');
  if (!sh) {
    throw new Error('ไม่เจอ sheet Config — รัน setupDatabase ก่อน');
  }

  // อ่าน key เดิมที่มี → map row index
  const lastRow = sh.getLastRow();
  const existingKeys = {};
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    data.forEach(function (row, i) {
      if (row[0]) existingKeys[row[0]] = i + 2;
    });
  }

  Object.keys(CONFIG_DEFAULTS).forEach(function (key) {
    const value = CONFIG_DEFAULTS[key];
    if (existingKeys[key]) {
      sh.getRange(existingKeys[key], 2).setValue(value);
      Logger.log('  [Config] update %s = %s', key, value);
    } else {
      sh.appendRow([key, value]);
      Logger.log('  [Config] insert %s = %s', key, value);
    }
  });

  Logger.log('=========================================');
  Logger.log('seed Config เสร็จ — ตรวจดูใน sheet ได้เลย');
}

/**
 * หา Sheet ID จากชื่อใน Drive — ใช้ตอนยังไม่ได้ตั้ง Script Properties
 * (พอ TASK-08 เสร็จจะอ่านจาก PropertiesService แทน)
 */
function findSheetId_() {
  const files = DriveApp.getFilesByName(DB_NAME);
  if (!files.hasNext()) {
    throw new Error('ไม่เจอไฟล์ "' + DB_NAME + '" ใน Drive — รัน setupDatabase ก่อน');
  }
  return files.next().getId();
}

// ========================================================================
// migration — Checkins v1 (one row per checkin) → v2 (4-slot per day)
// ========================================================================

/**
 * Migrate Checkins schema:
 *   - rename existing Checkins → Checkins_v1_archive_<timestamp>
 *   - create new Checkins with 4-slot headers
 *
 * idempotent: รันซ้ำได้ — ถ้า Checkins มี header v2 อยู่แล้วจะไม่ทำอะไร
 */
function migrateToFourSlots() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID not set');
  const ss = SpreadsheetApp.openById(sheetId);

  const cur = ss.getSheetByName('Checkins');
  if (cur) {
    const headers = cur.getRange(1, 1, 1, cur.getLastColumn()).getValues()[0];
    if (headers.indexOf('slot1_at') >= 0) {
      Logger.log('Checkins schema = v2 อยู่แล้ว — ข้าม');
      return;
    }
    const archiveName = 'Checkins_v1_archive_' +
      Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
    cur.setName(archiveName);
    Logger.log('archived old Checkins → ' + archiveName);
  }

  ensureSheetWithHeaders_(ss, 'Checkins', SHEET_HEADERS.Checkins);
  Logger.log('สร้าง Checkins v2 (4-slot) เรียบร้อย — ' + SHEET_HEADERS.Checkins.length + ' columns');
}

// ========================================================================
// TASK-08 (partial) — set non-secret Script Properties
// ========================================================================

// ค่า non-secret ที่ hardcode ได้ — sync กับ project memory
const NON_SECRET_PROPS = {
  SHEET_ID: '1XUj8b1ecKfYFlRUmVOmNawv4fDhak62HQFIXXZON-C4',
  DRIVE_FOLDER_ID: '13djS1gxQDzdDKutqeQwx7keZM6y2j0CM',
  DRIVE_FOLDER_SELFIES: '1PPc_9YY0bzOtbhdbBWvdpj96owGN_lKy',
  DRIVE_FOLDER_ID_CARDS: '18aU96CnKUKG3AhE9kBnsYL5Y1uJNWbIg',
  DRIVE_FOLDER_DAILY_CHECKINS: '17KFzPPmjnswhFnzX23wj71iGz43VJw8T',
  LIFF_ID_REGISTER: '2010027935-yGV4yPSO',
  LIFF_ID_CHECKIN: '2010027935-VNfQm4KC',
  LIFF_ID_BALANCE: '2010027935-GqOSphZC',
  OWNER_LINE_USER_ID: 'U4b33c5ea9673d07f3e275efaa4db02a2',
};

/**
 * เซ็ต Script Properties ที่ไม่ใช่ความลับ (Sheet ID / Drive ID / LIFF IDs)
 * idempotent: รันซ้ำได้
 *
 * ส่วนความลับ (LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, OWNER_LINE_USER_ID)
 * ตั้งผ่าน UI: Project Settings → Script Properties → Add (กัน leak ลง git)
 */
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(NON_SECRET_PROPS).forEach(function (key) {
    props.setProperty(key, NON_SECRET_PROPS[key]);
    Logger.log('  set %s', key);
  });
  Logger.log('=========================================');
  Logger.log('non-secret properties ตั้งครบแล้ว %d ค่า', Object.keys(NON_SECRET_PROPS).length);
  Logger.log('ส่วน secret ตั้งผ่าน UI: Project Settings → Script Properties');
  Logger.log('  - LINE_CHANNEL_ACCESS_TOKEN');
  Logger.log('  - LINE_CHANNEL_SECRET');
  Logger.log('  - OWNER_LINE_USER_ID (รอจาก myid page)');
}

// ========================================================================
// TASK-03 — สร้าง Drive folder + 3 sub-folder
// ========================================================================

const DRIVE_ROOT = 'partime-checkin-images';
const DRIVE_SUBS = ['selfies', 'id-cards', 'daily-checkins'];

/**
 * สร้าง folder partime-checkin-images + 3 sub-folder
 * ตั้ง permission anyone with link → viewer
 * idempotent: ถ้ามี folder ชื่อเดียวกันอยู่แล้วใช้ตัวเดิม
 *
 * วิธีใช้: กด Run บน function `setupDrive`
 */
function setupDrive() {
  const root = ensureFolder_(DriveApp.getRootFolder(), DRIVE_ROOT);
  setAnyoneWithLink_(root);
  Logger.log('root: %s (id=%s)', DRIVE_ROOT, root.getId());

  const subIds = {};
  DRIVE_SUBS.forEach(function (name) {
    const sub = ensureFolder_(root, name);
    setAnyoneWithLink_(sub);
    subIds[name] = sub.getId();
    Logger.log('  - %s (id=%s)', name, sub.getId());
  });

  Logger.log('=========================================');
  Logger.log('DRIVE_FOLDER_ID = %s', root.getId());
  Logger.log('  selfies        = %s', subIds['selfies']);
  Logger.log('  id-cards       = %s', subIds['id-cards']);
  Logger.log('  daily-checkins = %s', subIds['daily-checkins']);
  Logger.log('=========================================');
  Logger.log('copy DRIVE_FOLDER_ID ไปใส่ Script Properties (TASK-08)');

  return { rootId: root.getId(), subIds: subIds };
}

/**
 * หา folder ชื่อ name ใน parent — ถ้าไม่มีสร้างใหม่ ถ้ามีคืนตัวแรกที่เจอ
 */
function ensureFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/**
 * ตั้ง permission anyone with link viewer
 * (ครอบเป็น try-catch กัน Drive shared-with-me ที่กดไม่ได้)
 */
function setAnyoneWithLink_(folder) {
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log('  [warn] ตั้ง sharing ไม่สำเร็จ: %s', err.message);
  }
}
