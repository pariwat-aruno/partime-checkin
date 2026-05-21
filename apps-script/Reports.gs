/**
 * Reports.gs — เมนู owner: รายชื่อ / รายงานยอดจ่าย / ย้อนหลัง / รายละเอียด  [P5]
 *
 * actions (owner-only):
 *   getAllEmployees({ lineUserId })                       → ทุกคน + active + สถิติ
 *   getEmployeeDetail({ lineUserId, employeeId })         → รายละเอียด + payments + slip
 *   getPaymentReport({ lineUserId, granularity, date })   → ยอดจ่าย วัน/เดือน/ปี
 *   getWorkHistory({ lineUserId, granularity, date })     → ใครมาทำงาน + ค่าจ้าง
 *
 * granularity: 'day' (date=YYYY-MM-DD) | 'month' (YYYY-MM) | 'year' (YYYY)
 */

/** อ่านทั้ง sheet → array ของ object (header-keyed) */
function readSheetObjects_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const d = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  return d.map(function (row) {
    const o = {};
    h.forEach(function (k, j) { o[k] = row[j]; });
    return o;
  });
}

function dateStr_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
  return String(d || '');
}

function isActiveEmp_(e) {
  if (e.terminated_at) return false;
  return e.is_active === true || String(e.is_active).toLowerCase() === 'true';
}

// ========================================================================
// รายชื่อพนักงานทั้งหมด + สถิติ
// ========================================================================
function getAllEmployees(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const cfg = getConfig();

  const emps = readSheetObjects_(ss, 'Employees');
  const checkins = readSheetObjects_(ss, 'Checkins');
  const payments = readSheetObjects_(ss, 'Payments');

  // aggregate ต่อ employee — มากี่ครั้ง (approved) + ได้เงินรวม (ยอด checkin)
  const worked = {}; // emp → { days, wage }
  checkins.forEach(function (c) {
    if (c.status !== 'approved') return;
    const id = c.employee_id;
    if (!worked[id]) worked[id] = { days: 0, wage: 0 };
    worked[id].days++;
    worked[id].wage += Number(c.wage || 0);
  });
  const paid = {}; // emp → { paid_total, last_paid }
  payments.forEach(function (p) {
    const id = p.employee_id;
    if (!paid[id]) paid[id] = { paid_total: 0, last_paid: '' };
    if (p.status === 'จ่ายแล้ว') {
      paid[id].paid_total += Number(p.total_amount || 0);
      const pa = p.paid_at ? dateStr_(p.paid_at) : '';
      if (pa > paid[id].last_paid) paid[id].last_paid = pa;
    }
  });

  const list = emps.map(function (e) {
    const w = worked[e.employee_id] || { days: 0, wage: 0 };
    const pd = paid[e.employee_id] || { paid_total: 0, last_paid: '' };
    return {
      employee_id: e.employee_id,
      display_name: e.display_name,
      nickname: e.nickname || '',
      phone: e.phone || '',
      bank_name: e.bank_name || '',
      bank_account_no: e.bank_account_no || '',
      daily_wage: e.daily_wage !== '' && e.daily_wage != null ? Number(e.daily_wage) : null,
      active: isActiveEmp_(e),
      terminated_at: e.terminated_at ? dateStr_(e.terminated_at) : '',
      times_worked: w.days,
      total_earned: w.wage,
      paid_total: pd.paid_total,
      last_paid: pd.last_paid,
    };
  });

  return {
    ok: true,
    default_wage: Number(cfg.wage_default) || 400,
    total: list.length,
    active_count: list.filter(function (e) { return e.active; }).length,
    employees: list,
  };
}

// ========================================================================
// รายละเอียดพนักงาน (สถานะ/มากี่ครั้ง/ได้เงิน/จ่ายวันไหน/สลิป)
// ========================================================================
function getEmployeeDetail(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const emp = findEmployeeById_(payload && payload.employeeId);
  if (!emp) return { ok: false, error: 'employee_not_found' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const cfg = getConfig();

  const checkins = readSheetObjects_(ss, 'Checkins')
    .filter(function (c) { return c.employee_id === emp.employee_id; });
  const payments = readSheetObjects_(ss, 'Payments')
    .filter(function (p) { return p.employee_id === emp.employee_id; });

  let daysWorked = 0, totalEarned = 0, paidTotal = 0;
  checkins.forEach(function (c) {
    if (c.status === 'approved') { daysWorked++; totalEarned += Number(c.wage || 0); }
  });
  const payList = payments.map(function (p) {
    if (p.status === 'จ่ายแล้ว') paidTotal += Number(p.total_amount || 0);
    return {
      payment_id: p.payment_id,
      period: String(p.period || ''),
      total_amount: Number(p.total_amount || 0),
      status: p.status,
      closed_at: p.closed_at ? formatBangkokDateTime__(p.closed_at) : '',
      paid_at: p.paid_at ? formatBangkokDateTime__(p.paid_at) : '',
      slip_url: p.slip_url || '',
    };
  }).sort(function (a, b) { return a.period < b.period ? 1 : -1; });

  return {
    ok: true,
    employee_id: emp.employee_id,
    display_name: emp.display_name,
    nickname: emp.nickname || '',
    phone: emp.phone || '',
    bank_name: emp.bank_name || '',
    bank_account_no: emp.bank_account_no || '',
    daily_wage: emp.daily_wage !== '' && emp.daily_wage != null ? Number(emp.daily_wage) : null,
    default_wage: Number(cfg.wage_default) || 400,
    active: isActiveEmp_(emp),
    terminated_at: emp.terminated_at ? dateStr_(emp.terminated_at) : '',
    days_worked: daysWorked,
    total_earned: totalEarned,
    paid_total: paidTotal,
    payments: payList,
  };
}

// ========================================================================
// รายงานยอดจ่าย (วัน/เดือน/ปี)
// ========================================================================
function getPaymentReport(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const date = String((payload && payload.date) || '');
  const gran = (payload && payload.granularity) || 'month';

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const payments = readSheetObjects_(ss, 'Payments');
  const empName = nameMap_(ss);

  let total = 0, paid = 0, unpaid = 0, count = 0;
  const items = [];
  payments.forEach(function (p) {
    if (String(p.period || '').indexOf(date) !== 0) return;
    const amt = Number(p.total_amount || 0);
    total += amt; count++;
    if (p.status === 'จ่ายแล้ว') paid += amt; else unpaid += amt;
    items.push({
      payment_id: p.payment_id,
      employee_id: p.employee_id,
      name: empName[p.employee_id] || p.employee_id,
      period: String(p.period || ''),
      total_amount: amt,
      status: p.status,
      paid_at: p.paid_at ? formatBangkokDateTime__(p.paid_at) : '',
    });
  });
  items.sort(function (a, b) { return b.total_amount - a.total_amount; });

  return { ok: true, granularity: gran, date: date, total: total, paid: paid, unpaid: unpaid, count: count, items: items };
}

// ========================================================================
// ดูย้อนหลัง — ใครมาทำงาน + ค่าจ้าง (วัน/เดือน/ปี)
// ========================================================================
function getWorkHistory(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  const date = String((payload && payload.date) || '');
  const gran = (payload && payload.granularity) || 'day';

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const checkins = readSheetObjects_(ss, 'Checkins');
  const empName = nameMap_(ss);
  const empNick = nameMap_(ss, 'nickname');

  const agg = {}; // emp → { days, wage }
  let totalWage = 0, totalDays = 0;
  checkins.forEach(function (c) {
    if (c.status !== 'approved') return;
    if (dateStr_(c.checkin_date).indexOf(date) !== 0) return;
    const id = c.employee_id;
    if (!agg[id]) agg[id] = { days: 0, wage: 0 };
    agg[id].days++;
    agg[id].wage += Number(c.wage || 0);
    totalWage += Number(c.wage || 0);
    totalDays++;
  });

  const byEmployee = Object.keys(agg).map(function (id) {
    return {
      employee_id: id,
      name: empName[id] || id,
      nickname: empNick[id] || '',
      days: agg[id].days,
      wage: agg[id].wage,
    };
  }).sort(function (a, b) { return b.wage - a.wage; });

  return { ok: true, granularity: gran, date: date, total_wage: totalWage, total_days: totalDays, byEmployee: byEmployee };
}

/** map employee_id → field (default display_name) */
function nameMap_(ss, field) {
  const f = field || 'display_name';
  const m = {};
  readSheetObjects_(ss, 'Employees').forEach(function (e) { m[e.employee_id] = e[f] || ''; });
  return m;
}
