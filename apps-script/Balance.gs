/**
 * Balance.gs — flow D handler — รองรับ 4-slot
 *
 * input: { lineUserId }
 * output: {
 *   ok: true,
 *   currentMonth: { full, half, total },     // เฉพาะวันที่ approved
 *   incompleteApproved,                       // วันที่ approved แต่สแกนไม่ครบ 4
 *   pendingDays,                              // status=pending ทั้งหมด (รวมไม่ครบ)
 *   lastPayment: { period, total, status }
 * }
 */

function getBalance(payload) {
  if (!payload || !payload.lineUserId) {
    return { ok: false, error: 'missing_fields' };
  }
  const emp = findEmployeeByLineUserId(payload.lineUserId);
  if (!emp) return { ok: false, error: 'not_registered' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const month = thisMonthBangkok();

  const stats = sumCheckinsForMonth_(ss, emp.employee_id, month);
  const pending = countPendingCheckins_(ss, emp.employee_id);
  const lastPayment = findLastPayment_(ss, emp.employee_id);

  return {
    ok: true,
    employeeId: emp.employee_id,
    displayName: emp.display_name,
    currentMonth: { full: stats.full, half: stats.half, total: stats.total },
    incompleteApproved: stats.incompleteApproved,
    pendingDays: pending,
    lastPayment: lastPayment,
  };
}

function sumCheckinsForMonth_(ss, employeeId, monthStr) {
  const sh = ss.getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return { full: 0, half: 0, total: 0, incompleteApproved: 0 };
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iEmp = headers.indexOf('employee_id');
  const iDate = headers.indexOf('checkin_date');
  const iStatus = headers.indexOf('status');
  const iDayType = headers.indexOf('day_type');
  const iWage = headers.indexOf('wage');
  const iScan = headers.indexOf('scan_count');

  let full = 0, half = 0, total = 0, incompleteApproved = 0;
  data.forEach(function (row) {
    if (row[iEmp] !== employeeId) return;
    if (row[iStatus] !== 'approved') return;
    const d = row[iDate];
    const ym = (d instanceof Date)
      ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM')
      : String(d).substring(0, 7);
    if (ym !== monthStr) return;
    if (row[iDayType] === 'full') full++;
    if (row[iDayType] === 'half') half++;
    total += Number(row[iWage] || 0);
    if (Number(row[iScan] || 0) < 4) incompleteApproved++;
  });
  return { full: full, half: half, total: total, incompleteApproved: incompleteApproved };
}

function countPendingCheckins_(ss, employeeId) {
  const sh = ss.getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iEmp = headers.indexOf('employee_id');
  const iStatus = headers.indexOf('status');
  let count = 0;
  data.forEach(function (row) {
    if (row[iEmp] === employeeId && row[iStatus] === 'pending') count++;
  });
  return count;
}

function findLastPayment_(ss, employeeId) {
  const sh = ss.getSheetByName('Payments');
  ensurePaymentExtraColumns_(sh);
  const last = sh.getLastRow();
  if (last < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iEmp = headers.indexOf('employee_id');
  const iPeriod = headers.indexOf('period');
  const iBase = headers.indexOf('base_amount');
  const iExtra = headers.indexOf('extra_amount');
  const iOt = headers.indexOf('ot_amount');
  const iAmount = headers.indexOf('total_amount');
  const iStatus = headers.indexOf('status');
  const iClosed = headers.indexOf('closed_at');
  const iAdjNote = headers.indexOf('adjustment_note');

  let last_ = null;
  data.forEach(function (row) {
    if (row[iEmp] !== employeeId) return;
    if (!last_ || String(row[iClosed]) > String(last_._closed)) {
      last_ = {
        period: row[iPeriod],
        base: Number(row[iBase] || 0),
        extra: Number(row[iExtra] || 0),
        ot: Number(row[iOt] || 0),
        total: Number(row[iAmount] || 0),
        status: row[iStatus],
        adjustmentNote: iAdjNote >= 0 ? row[iAdjNote] : '',
        _closed: row[iClosed],
      };
    }
  });
  if (last_) delete last_._closed;
  return last_;
}
