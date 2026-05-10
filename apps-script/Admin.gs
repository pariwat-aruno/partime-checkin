/**
 * Admin.gs — endpoints สำหรับ LIFF admin (เจ้าของเท่านั้น)
 *
 * - getOwnerDashboard({ lineUserId, period }): list ทุก active employee + ยอดในเดือน + payment row ของเดือน
 * - markPaid({ lineUserId, paymentId }): รอจ่าย → จ่ายแล้ว + paid_at
 *
 * closePeriod ตัวจริงอยู่ใน Payment.gs (เพิ่ม owner verify แล้ว)
 */

/**
 * dashboard data — รวมทุก active employee + ยอดในเดือน + payment status
 *
 * input:  { lineUserId, period? }   period = 'YYYY-MM' (default = เดือนนี้)
 * output: { ok, period, employees: [...] }
 *   employees[i]:
 *     - employee_id, display_name
 *     - approved_full, approved_half, total_amount, pending
 *     - payment: null | { payment_id, total_amount, status, closed_at, paid_at }
 */
function getOwnerDashboard(payload) {
  if (!isOwner(payload && payload.lineUserId)) {
    return { ok: false, error: 'not_owner' };
  }
  const period = (payload && payload.period) || thisMonthBangkok();

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);

  // active employees
  const empSh = ss.getSheetByName('Employees');
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

  // checkins ของเดือนนี้ (group by employee)
  const checkSh = ss.getSheetByName('Checkins');
  const checkAgg = {}; // employee_id → {full, half, total, pending}
  const cl = checkSh.getLastRow();
  if (cl >= 2) {
    const ch = checkSh.getRange(1, 1, 1, checkSh.getLastColumn()).getValues()[0];
    const cd = checkSh.getRange(2, 1, cl - 1, checkSh.getLastColumn()).getValues();
    const iEmp = ch.indexOf('employee_id');
    const iDate = ch.indexOf('checkin_date');
    const iStatus = ch.indexOf('status');
    const iDayType = ch.indexOf('day_type');
    const iWage = ch.indexOf('wage');
    cd.forEach(function (row) {
      const d = row[iDate];
      const ym = (d instanceof Date)
        ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM')
        : String(d).substring(0, 7);
      if (ym !== period) return;
      const eid = row[iEmp];
      if (!checkAgg[eid]) checkAgg[eid] = { full: 0, half: 0, total: 0, pending: 0 };
      if (row[iStatus] === 'approved') {
        if (row[iDayType] === 'full') checkAgg[eid].full++;
        if (row[iDayType] === 'half') checkAgg[eid].half++;
        checkAgg[eid].total += Number(row[iWage] || 0);
      } else if (row[iStatus] === 'pending') {
        checkAgg[eid].pending++;
      }
    });
  }

  // payments ของเดือนนี้
  const paySh = ss.getSheetByName('Payments');
  const payMap = {}; // employee_id → {payment_id, total_amount, status, closed_at, paid_at}
  const pl = paySh.getLastRow();
  if (pl >= 2) {
    const ph = paySh.getRange(1, 1, 1, paySh.getLastColumn()).getValues()[0];
    const pd = paySh.getRange(2, 1, pl - 1, paySh.getLastColumn()).getValues();
    const iPid = ph.indexOf('payment_id');
    const iEmp = ph.indexOf('employee_id');
    const iPeriod = ph.indexOf('period');
    const iAmount = ph.indexOf('total_amount');
    const iStatus = ph.indexOf('status');
    const iClosed = ph.indexOf('closed_at');
    const iPaid = ph.indexOf('paid_at');
    pd.forEach(function (row) {
      // รับทั้ง 'YYYY-MM' และ 'YYYY-MM-resign'
      if (String(row[iPeriod]).indexOf(period) !== 0) return;
      payMap[row[iEmp]] = {
        payment_id: row[iPid],
        total_amount: Number(row[iAmount] || 0),
        status: row[iStatus],
        closed_at: row[iClosed] ? formatBangkokDateTime__(row[iClosed]) : '',
        paid_at: row[iPaid] ? formatBangkokDateTime__(row[iPaid]) : '',
      };
    });
  }

  const result = employees.map(function (emp) {
    const agg = checkAgg[emp.employee_id] || { full: 0, half: 0, total: 0, pending: 0 };
    return {
      employee_id: emp.employee_id,
      display_name: emp.display_name,
      approved_full: agg.full,
      approved_half: agg.half,
      total_amount: agg.total,
      pending: agg.pending,
      payment: payMap[emp.employee_id] || null,
    };
  });

  return { ok: true, period: period, employees: result };
}

/**
 * แก้ Payments status รอจ่าย → จ่ายแล้ว (+ paid_at)
 *
 * input: { lineUserId, paymentId }
 */
function markPaid(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  if (!payload.paymentId) return { ok: false, error: 'missing_paymentId' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Payments');
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'payment_not_found' };

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  let rowIdx = -1;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === payload.paymentId) { rowIdx = i + 2; break; }
  }
  if (rowIdx < 0) return { ok: false, error: 'payment_not_found' };

  const iStatus = headers.indexOf('status') + 1;
  const iPaid = headers.indexOf('paid_at') + 1;
  sh.getRange(rowIdx, iStatus).setValue('จ่ายแล้ว');
  sh.getRange(rowIdx, iPaid).setValue(nowBangkok());

  logInfo('markPaid', 'paid', { paymentId: payload.paymentId });
  return { ok: true };
}

function formatBangkokDateTime__(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return Utilities.formatDate(dt, 'Asia/Bangkok', 'd MMM yyyy HH:mm');
}
