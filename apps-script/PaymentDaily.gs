/**
 * PaymentDaily.gs — ปิดยอดรายวัน + bulk close/pay + แนบสลิป  [P6]
 *
 * actions (owner-only):
 *   closeDaily({ lineUserId, employeeId, date?, confirm? })
 *   bulkClose({ lineUserId, employeeIds[], granularity:'day'|'month', date, confirm? })
 *   bulkMarkPaid({ lineUserId, paymentIds[], slipUrl? })
 *
 * ปิดรายวัน: period = 'YYYY-MM-DD' (รายเดือนใช้ closePeriod เดิม period='YYYY-MM')
 * checkin ที่ปิดแล้วถูก stamp payment_id → ไม่ถูกนับซ้ำในรอบเดือน
 */

/** sum approved checkins ของวันเดียว (ที่ยังไม่ถูกปิด) */
function sumApprovedForDay_(ss, employeeId, dateStr) {
  const sh = ss.getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return { full: 0, half: 0, total: 0, pending: 0, count: 0, rows: [] };
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const d = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iEmp = h.indexOf('employee_id');
  const iDate = h.indexOf('checkin_date');
  const iStatus = h.indexOf('status');
  const iDayType = h.indexOf('day_type');
  const iWage = h.indexOf('wage');
  const iPid = h.indexOf('payment_id');

  let full = 0, half = 0, total = 0, pending = 0, count = 0;
  const rows = [];
  d.forEach(function (row, i) {
    if (row[iEmp] !== employeeId) return;
    const ds = (row[iDate] instanceof Date)
      ? Utilities.formatDate(row[iDate], 'Asia/Bangkok', 'yyyy-MM-dd')
      : String(row[iDate]);
    if (ds !== dateStr) return;
    count++;
    if (iPid >= 0 && row[iPid]) return; // ปิดแล้ว
    if (row[iStatus] === 'approved') {
      if (row[iDayType] === 'full') full++;
      if (row[iDayType] === 'half') half++;
      total += Number(row[iWage] || 0);
      rows.push(i + 2);
    } else if (row[iStatus] === 'pending') {
      pending++;
    }
  });
  return { full: full, half: half, total: total, pending: pending, count: count, rows: rows };
}

/** core: ปิดยอดวันเดียวของพนักงานคนเดียว (ใช้โดย closeDaily, terminate, bulkClose) */
function closeDailyForEmployee_(employeeId, dateStr, ownerUserId, force) {
  const emp = findEmployeeById_(employeeId);
  if (!emp) return { ok: false, error: 'employee_not_found' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const stats = sumApprovedForDay_(ss, employeeId, dateStr);

  if (stats.rows.length === 0) {
    return { ok: false, error: 'nothing_to_close', employeeId: employeeId };
  }
  if (stats.pending > 0 && !force) {
    return { ok: false, error: 'has_pending', pending: stats.pending };
  }

  const sh = ss.getSheetByName('Payments');
  ensurePaymentExtraColumns_(sh);
  const dup = findPaymentForEmployeePeriod_(sh, employeeId, dateStr);
  if (dup) return { ok: false, error: 'payment_already_closed', paymentId: dup.payment_id };

  const total = stats.total;
  const paymentId = nextPaymentId(dateStr);
  appendPaymentRow_(sh, {
    payment_id: paymentId,
    employee_id: employeeId,
    period: dateStr,
    total_days_full: stats.full,
    total_days_half: stats.half,
    base_amount: total,
    extra_amount: 0,
    ot_amount: 0,
    total_amount: total,
    status: 'รอจ่าย',
    closed_at: nowBangkok(),
    paid_at: '',
    adjustment_note: '',
    note: 'รายวัน',
  });
  stampCheckinsPaymentId_(ss, stats.rows, paymentId);

  logOwnerAction(ownerUserId, 'close_daily', paymentId, emp.display_name, {
    period: dateStr, total: total, days_full: stats.full, days_half: stats.half,
  });

  return { ok: true, paymentId: paymentId, total: total, employeeId: employeeId, empName: employeeDisplay_(emp) };
}

/** action: ปิดยอดรายวัน (date default = วันนี้) */
function closeDaily(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  if (!payload.employeeId) return { ok: false, error: 'missing_fields' };
  const date = String(payload.date || todayBangkok());
  return closeDailyForEmployee_(payload.employeeId, date, payload.lineUserId, !!payload.confirm);
}

/** action: ปิดยอดหลายคนพร้อมกัน */
function bulkClose(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const ids = (payload && payload.employeeIds) || [];
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'no_employees' };
  const gran = payload.granularity || 'month';
  const date = String(payload.date || (gran === 'day' ? todayBangkok() : thisMonthBangkok()));

  const results = ids.map(function (empId) {
    let r;
    if (gran === 'day') {
      r = closeDailyForEmployee_(empId, date, payload.lineUserId, !!payload.confirm);
    } else {
      r = closePeriod({
        lineUserId: payload.lineUserId, employeeId: empId,
        period: date, confirm: !!payload.confirm,
      });
    }
    return { employeeId: empId, ok: r.ok, error: r.error || '', paymentId: r.paymentId || '', total: r.total || 0 };
  });
  const okCount = results.filter(function (x) { return x.ok; }).length;
  const sumTotal = results.reduce(function (s, x) { return s + (x.ok ? x.total : 0); }, 0);
  return { ok: true, granularity: gran, date: date, closed: okCount, failed: results.length - okCount, total: sumTotal, results: results };
}

/** action: mark จ่ายแล้วหลายคนพร้อมกัน (+ สลิปร่วม) */
function bulkMarkPaid(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const ids = (payload && payload.paymentIds) || [];
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'no_payments' };
  const slipUrl = payload.slipUrl || '';

  const results = ids.map(function (pid) {
    const r = markPaid({ lineUserId: payload.lineUserId, paymentId: pid, slipUrl: slipUrl });
    return { paymentId: pid, ok: r.ok, error: r.error || '', alreadyPaid: !!r.alreadyPaid };
  });
  const okCount = results.filter(function (x) { return x.ok; }).length;
  return { ok: true, paid: okCount, failed: results.length - okCount, results: results };
}
