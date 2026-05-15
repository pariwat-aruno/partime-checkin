/**
 * Report.gs — รายงานสำหรับเจ้าของ
 *
 * - getDailyReport({ date }): รายชื่อพาร์ทไทม์ทั้งหมดในวันที่ระบุ พร้อม scan_count + status
 * - bot command "รายงาน [YYYY-MM-DD]" → reply text รายงาน (เฉพาะเจ้าของ)
 * - bot command "รายงาน YYYY-MM-DD ถึง YYYY-MM-DD" → reply รวม range
 */

/** API endpoint */
function getDailyReport(payload) {
  if (!isOwner(payload && payload.lineUserId)) {
    return { ok: false, error: 'not_owner' };
  }
  const date = payload && payload.date ? payload.date : todayBangkok();
  const list = listEmployeeScansForDate_(date);
  return { ok: true, date: date, employees: list };
}

/**
 * คืน list ของ active employees พร้อม scan info ในวันที่ระบุ
 *   [{ employee_id, display_name, scan_count, status, day_type, wage, has_out_of_range, has_row }]
 * รวม "ไม่มีแถว" (พาร์ทไทม์ที่ active แต่ไม่ได้สแกนเลย)
 */
function listEmployeeScansForDate_(dateStr) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const empSh = ss.getSheetByName('Employees');
  const checkSh = ss.getSheetByName('Checkins');

  // active employees
  const employees = [];
  const empLast = empSh.getLastRow();
  if (empLast >= 2) {
    const eh = empSh.getRange(1, 1, 1, empSh.getLastColumn()).getValues()[0];
    const ed = empSh.getRange(2, 1, empLast - 1, empSh.getLastColumn()).getValues();
    const iId = eh.indexOf('employee_id');
    const iName = eh.indexOf('display_name');
    const iActive = eh.indexOf('is_active');
    ed.forEach(function (row) {
      if (row[iActive] !== true && String(row[iActive]).toLowerCase() !== 'true') return;
      employees.push({ employee_id: row[iId], display_name: row[iName] });
    });
  }

  // checkins ของวันนั้น
  const checkMap = {};
  const cl = checkSh.getLastRow();
  if (cl >= 2) {
    const ch = checkSh.getRange(1, 1, 1, checkSh.getLastColumn()).getValues()[0];
    const cd = checkSh.getRange(2, 1, cl - 1, checkSh.getLastColumn()).getValues();
    const iEmp = ch.indexOf('employee_id');
    const iDate = ch.indexOf('checkin_date');
    const iScan = ch.indexOf('scan_count');
    const iStatus = ch.indexOf('status');
    const iDayType = ch.indexOf('day_type');
    const iWage = ch.indexOf('wage');
    const iOOR = ch.indexOf('has_out_of_range');
    cd.forEach(function (row) {
      const d = row[iDate];
      const dStr = (d instanceof Date)
        ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd')
        : String(d);
      if (dStr !== dateStr) return;
      checkMap[row[iEmp]] = {
        scan_count: Number(row[iScan] || 0),
        status: row[iStatus],
        day_type: row[iDayType],
        wage: Number(row[iWage] || 0),
        has_out_of_range: row[iOOR] === true,
      };
    });
  }

  return employees.map(function (emp) {
    const c = checkMap[emp.employee_id];
    return Object.assign({}, emp, c || {
      scan_count: 0, status: '—', day_type: '', wage: 0, has_out_of_range: false,
    }, { has_row: !!c });
  });
}

/**
 * bot command "รายงาน [YYYY-MM-DD]" หา bot — เฉพาะเจ้าของ
 */
function replyDailyReport_(ev, dateStr) {
  if (!isOwner(ev.source && ev.source.userId)) {
    return replyText(ev.replyToken, 'เฉพาะเจ้าของเท่านั้นที่ดูรายงานได้');
  }
  const date = dateStr || todayBangkok();
  const list = listEmployeeScansForDate_(date);

  if (list.length === 0) {
    return replyText(ev.replyToken, '📋 รายงาน ' + date + '\n\nไม่มีพาร์ทไทม์ active');
  }

  // build text report
  const lines = ['รายงาน ' + date + ' (' + list.length + ' คน) — บริษัท วอร์ด้า สกินแคร์ จำกัด', ''];
  let completeCount = 0, incompleteCount = 0, noScanCount = 0;

  list.forEach(function (e) {
    let tag;
    if (!e.has_row) {
      tag = '[ไม่สแกน]'; noScanCount++;
    } else if (e.scan_count === 4) {
      tag = '[ครบ]'; completeCount++;
    } else {
      tag = '[ไม่ครบ]'; incompleteCount++;
    }
    let line = tag + ' ' + e.employee_id + ' ' + e.display_name + ' — ' +
      (e.has_row ? ('สแกน ' + e.scan_count + '/4') : '0/4');
    if (e.has_row) {
      line += ' — ' + e.status;
      if (e.status === 'approved' && e.day_type) {
        line += ' (' + e.day_type + ' ' + e.wage + ')';
      }
      if (e.has_out_of_range) line += ' [นอกรัศมี]';
    }
    lines.push(line);
  });

  lines.push('');
  lines.push('สรุป: ครบ ' + completeCount + ' / ไม่ครบ ' + incompleteCount + ' / ไม่สแกน ' + noScanCount);
  lines.push('');
  lines.push('พิมพ์ "รอ" ดูรายการรออนุมัติพร้อมรูป');

  return replyText(ev.replyToken, lines.join('\n'));
}
