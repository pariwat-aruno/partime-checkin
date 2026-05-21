/**
 * Settings.gs — owner ตั้งค่าระบบ + แก้ค่าจ้างรายคน  [P2]
 *
 * actions:
 *   getSettings({ lineUserId })
 *   saveSettings({ lineUserId, wage_default, late_grace_minutes, work_start_time })
 *   setEmployeeWage({ lineUserId, employeeId, dailyWage })   // dailyWage='' = ใช้ default
 */

/** เขียน/อัปเดต 1 key ใน sheet Config + ล้าง cache */
function setConfigValue_(key, value) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Config');
  if (!sh) throw new Error('sheet Config not found');
  const last = sh.getLastRow();
  let rowNum = 0;
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i][0] === key) { rowNum = i + 2; break; }
    }
  }
  if (rowNum) {
    sh.getRange(rowNum, 2).setValue(value);
  } else {
    sh.appendRow([key, value]);
  }
  clearConfigCache();
}

/** อ่านค่าตั้งระบบปัจจุบัน */
function getSettings(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const cfg = getConfig();
  return {
    ok: true,
    settings: {
      wage_default: Number(cfg.wage_default) || 400,
      late_grace_minutes: Number(cfg.late_grace_minutes) || 0,
      work_start_time: String(cfg.work_start_time || '08:00'),
      work_hours_per_day: WORK_HOURS_PER_DAY,
    },
  };
}

/** บันทึกค่าตั้งระบบ (validate ก่อนเขียน) */
function saveSettings(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };

  const wage = Number(payload.wage_default);
  if (isNaN(wage) || wage <= 0) return { ok: false, error: 'invalid_wage_default' };

  const grace = Number(payload.late_grace_minutes);
  if (isNaN(grace) || grace < 0) return { ok: false, error: 'invalid_grace' };

  const start = String(payload.work_start_time || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(start)) return { ok: false, error: 'invalid_work_start_time' };

  setConfigValue_('wage_default', wage);
  setConfigValue_('late_grace_minutes', grace);
  setConfigValue_('work_start_time', start);

  logOwnerAction(payload.lineUserId, 'save_settings', '', '', {
    wage_default: wage, late_grace_minutes: grace, work_start_time: start,
  });
  return { ok: true, settings: getSettings(payload).settings };
}

/** ตั้งค่าจ้าง/วัน รายบุคคล ('' = ใช้ default) */
function setEmployeeWage(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const emp = findEmployeeById_(payload && payload.employeeId);
  if (!emp) return { ok: false, error: 'employee_not_found' };

  let val = payload.dailyWage;
  if (val === '' || val == null) {
    val = ''; // ล้าง = กลับไปใช้ default
  } else {
    val = Number(val);
    if (isNaN(val) || val <= 0) return { ok: false, error: 'invalid_wage' };
  }

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Employees');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf('daily_wage');
  if (col < 0) return { ok: false, error: 'daily_wage_column_missing' };
  sh.getRange(emp._rowNumber, col + 1).setValue(val);

  logOwnerAction(payload.lineUserId, 'set_employee_wage', emp.employee_id, emp.display_name, {
    dailyWage: val === '' ? '(default)' : val,
  });
  return { ok: true, employeeId: emp.employee_id, dailyWage: val };
}
