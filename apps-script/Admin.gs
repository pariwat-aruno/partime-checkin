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
  ensurePaymentExtraColumns_(paySh);
  const payMap = {}; // employee_id → {payment_id, total_amount, status, closed_at, paid_at}
  const pl = paySh.getLastRow();
  if (pl >= 2) {
    const ph = paySh.getRange(1, 1, 1, paySh.getLastColumn()).getValues()[0];
    const pd = paySh.getRange(2, 1, pl - 1, paySh.getLastColumn()).getValues();
    const iPid = ph.indexOf('payment_id');
    const iEmp = ph.indexOf('employee_id');
    const iPeriod = ph.indexOf('period');
    const iBase = ph.indexOf('base_amount');
    const iExtra = ph.indexOf('extra_amount');
    const iOt = ph.indexOf('ot_amount');
    const iAmount = ph.indexOf('total_amount');
    const iStatus = ph.indexOf('status');
    const iClosed = ph.indexOf('closed_at');
    const iPaid = ph.indexOf('paid_at');
    const iAdjNote = ph.indexOf('adjustment_note');
    pd.forEach(function (row) {
      // รับทั้ง 'YYYY-MM' และ 'YYYY-MM-resign'
      if (String(row[iPeriod]).indexOf(period) !== 0) return;
      payMap[row[iEmp]] = {
        payment_id: row[iPid],
        base_amount: Number(row[iBase] || 0),
        extra_amount: Number(row[iExtra] || 0),
        ot_amount: Number(row[iOt] || 0),
        total_amount: Number(row[iAmount] || 0),
        status: row[iStatus],
        closed_at: row[iClosed] ? formatBangkokDateTime__(row[iClosed]) : '',
        paid_at: row[iPaid] ? formatBangkokDateTime__(row[iPaid]) : '',
        adjustment_note: iAdjNote >= 0 ? row[iAdjNote] : '',
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
  ensurePaymentExtraColumns_(sh);
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
  const iEmp = headers.indexOf('employee_id');
  const iAmount = headers.indexOf('total_amount');
  const iPeriod = headers.indexOf('period');
  const rowVals = sh.getRange(rowIdx, 1, 1, sh.getLastColumn()).getValues()[0];
  const emp = findEmployeeById_(rowVals[iEmp]);
  const empName = emp ? emp.display_name : rowVals[iEmp];
  const oldStatus = rowVals[iStatus - 1];

  if (oldStatus === 'จ่ายแล้ว') {
    return { ok: true, alreadyPaid: true };
  }

  sh.getRange(rowIdx, iStatus).setValue('จ่ายแล้ว');
  sh.getRange(rowIdx, iPaid).setValue(nowBangkok());

  logInfo('markPaid', 'paid', { paymentId: payload.paymentId });

  logOwnerAction(payload.lineUserId, 'mark_paid', payload.paymentId, empName, {
    period: rowVals[iPeriod],
    total: Number(rowVals[iAmount] || 0),
  });

  const notified = notifyEmployeePaid_(emp, rowVals[iPeriod], Number(rowVals[iAmount] || 0), payload.paymentId);
  if (!notified) {
    pushToAllOwners([{ type: 'text', text: 'แจ้งเตือน: บันทึกจ่ายแล้ว แต่ส่งข้อความหาพนักงานไม่สำเร็จ\n' + empName + '\n' + payload.paymentId }]);
  }

  return { ok: true, employeeNotified: notified };
}

/**
 * แก้ Payments status จ่ายแล้ว → รอจ่าย (+ clear paid_at)
 *
 * input: { lineUserId, paymentId, reason }
 */
function restorePaymentPending(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  if (!payload.paymentId) return { ok: false, error: 'missing_paymentId' };
  const reason = String((payload && payload.reason) || '').trim();
  if (!reason) return { ok: false, error: 'missing_reason' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Payments');
  ensurePaymentExtraColumns_(sh);
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'payment_not_found' };

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iPid = headers.indexOf('payment_id');
  const iStatus = headers.indexOf('status');
  const iPaid = headers.indexOf('paid_at');
  const iEmp = headers.indexOf('employee_id');
  const iPeriod = headers.indexOf('period');
  const iAmount = headers.indexOf('total_amount');

  let rowIdx = -1;
  let rowVals = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i][iPid] === payload.paymentId) {
      rowIdx = i + 2;
      rowVals = data[i];
      break;
    }
  }
  if (rowIdx < 0) return { ok: false, error: 'payment_not_found' };
  if (rowVals[iStatus] !== 'จ่ายแล้ว') return { ok: false, error: 'not_paid' };

  sh.getRange(rowIdx, iStatus + 1).setValue('รอจ่าย');
  sh.getRange(rowIdx, iPaid + 1).setValue('');

  const emp = findEmployeeById_(rowVals[iEmp]);
  const empName = emp ? emp.display_name : rowVals[iEmp];
  logOwnerAction(payload.lineUserId, 'restore_pending', payload.paymentId, empName, {
    period: rowVals[iPeriod],
    total: Number(rowVals[iAmount] || 0),
    reason: reason,
  });

  let notified = false;
  if (emp && emp.line_user_id) {
    const res = pushText(emp.line_user_id,
      'บริษัท วอร์ด้า สกินแคร์ จำกัด\n\n' +
      'มีการแก้ไขสถานะการจ่ายเงิน\n' +
      'รอบ: ' + rowVals[iPeriod] + '\n' +
      'รหัสรายการ: ' + payload.paymentId + '\n' +
      'ยอด: ' + formatBaht_(Number(rowVals[iAmount] || 0)) + '\n' +
      'สถานะใหม่: รอจ่าย\n' +
      'เหตุผล: ' + reason);
    notified = res && res.ok === true;
  }
  if (!notified) {
    pushToAllOwners([{ type: 'text', text: 'แจ้งเตือน: แก้สถานะเป็นรอจ่ายแล้ว แต่ส่งข้อความหาพนักงานไม่สำเร็จ\n' + empName + '\n' + payload.paymentId }]);
  }

  return { ok: true, employeeNotified: notified };
}

function formatBangkokDateTime__(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return Utilities.formatDate(dt, 'Asia/Bangkok', 'd MMM yyyy HH:mm');
}

/**
 * list pending checkins ของพาร์ทไทม์คนเดียว
 * input: { lineUserId, employeeId }
 * output: { ok, employeeId, displayName, items: [{checkin_id, date, scan_count, slots, last_distance_m, has_out_of_range}] }
 */
function getPendingForEmployee(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  if (!payload.employeeId) return { ok: false, error: 'missing_employeeId' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName('Checkins');
  const cfg = getConfig();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, employeeId: payload.employeeId, items: [] };

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iId = headers.indexOf('checkin_id');
  const iEmp = headers.indexOf('employee_id');
  const iDate = headers.indexOf('checkin_date');
  const iStatus = headers.indexOf('status');
  const iLastDist = headers.indexOf('last_distance_m');
  const iOOR = headers.indexOf('has_out_of_range');
  const iScan = headers.indexOf('scan_count');
  const slotIdx = [1, 2, 3, 4].map(function (s) {
    return { at: headers.indexOf('slot' + s + '_at'), url: headers.indexOf('slot' + s + '_url') };
  });

  const items = [];
  data.forEach(function (row) {
    if (row[iEmp] !== payload.employeeId) return;
    if (row[iStatus] !== 'pending') return;
    const slots = slotIdx.map(function (sc, i) {
      const at = row[sc.at];
      const url = row[sc.url];
      return {
        slot: i + 1,
        label: getSlotLabel(cfg, i + 1),
        at: at ? formatBangkokDateTime__(at) : '',
        url: url || '',
        thumb: url ? driveThumbnail__(url) : '',
        completed: !!at,
      };
    });
    items.push({
      checkin_id: row[iId],
      date: (row[iDate] instanceof Date)
        ? Utilities.formatDate(row[iDate], 'Asia/Bangkok', 'yyyy-MM-dd')
        : String(row[iDate]),
      scan_count: Number(row[iScan] || 0),
      last_distance_m: Number(row[iLastDist] || 0),
      has_out_of_range: row[iOOR] === true,
      slots: slots,
    });
  });

  // sort เก่าก่อน (ปิดยอดได้ง่าย)
  items.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });

  // หา displayName
  const empSh = ss.getSheetByName('Employees');
  const eh = empSh.getRange(1, 1, 1, empSh.getLastColumn()).getValues()[0];
  const ed = empSh.getRange(2, 1, empSh.getLastRow() - 1, empSh.getLastColumn()).getValues();
  const iE = eh.indexOf('employee_id');
  const iN = eh.indexOf('display_name');
  let name = payload.employeeId;
  for (let i = 0; i < ed.length; i++) {
    if (ed[i][iE] === payload.employeeId) { name = ed[i][iN]; break; }
  }

  return { ok: true, employeeId: payload.employeeId, displayName: name, items: items };
}

/**
 * อนุมัติ/ปฏิเสธ checkin จาก Owner LIFF (เทียบเท่ากับการกด postback บน flex card)
 * input: { lineUserId, checkinId, action, type? }
 *   action: 'approve' | 'reject'
 *   type:   'full' | 'half' (เฉพาะตอน approve)
 */
function approveCheckin(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  if (!payload.checkinId || !payload.action) return { ok: false, error: 'missing_fields' };
  // updateCheckinStatus_ อยู่ใน WebApp.gs (shared namespace)
  return updateCheckinStatus_(payload.checkinId, payload.action, payload.type, payload.lineUserId);
}

/**
 * ประวัติรายคนในรอบที่เลือก
 * input: { lineUserId, employeeId, period }
 */
function getEmployeeHistory(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  if (!payload.employeeId) return { ok: false, error: 'missing_employeeId' };
  const period = (payload && payload.period) || thisMonthBangkok();

  const emp = findEmployeeById_(payload.employeeId);
  if (!emp) return { ok: false, error: 'employee_not_found' };

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const checkins = listEmployeeCheckinsForPeriod_(ss, payload.employeeId, period);
  const payments = listEmployeePaymentsForPeriod_(ss, payload.employeeId, period);
  return {
    ok: true,
    employeeId: payload.employeeId,
    displayName: emp.display_name,
    period: period,
    checkins: checkins,
    payments: payments,
  };
}

function listEmployeeCheckinsForPeriod_(ss, employeeId, period) {
  const sh = ss.getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iId = headers.indexOf('checkin_id');
  const iEmp = headers.indexOf('employee_id');
  const iDate = headers.indexOf('checkin_date');
  const iStatus = headers.indexOf('status');
  const iDayType = headers.indexOf('day_type');
  const iWage = headers.indexOf('wage');
  const iScan = headers.indexOf('scan_count');
  const iDist = headers.indexOf('last_distance_m');
  const iOOR = headers.indexOf('has_out_of_range');
  const slotIdx = [1, 2, 3, 4].map(function (s) {
    return { at: headers.indexOf('slot' + s + '_at'), url: headers.indexOf('slot' + s + '_url') };
  });
  const ackMap = buildOwnerAckMapForPeriod_(ss, employeeId, period);

  const items = [];
  data.forEach(function (row) {
    if (row[iEmp] !== employeeId) return;
    const date = formatSheetDate_(row[iDate], 'yyyy-MM-dd');
    if (date.substring(0, 7) !== period) return;
    items.push({
      checkin_id: row[iId],
      date: date,
      status: row[iStatus],
      day_type: row[iDayType],
      wage: Number(row[iWage] || 0),
      scan_count: Number(row[iScan] || 0),
      last_distance_m: Number(row[iDist] || 0),
      has_out_of_range: row[iOOR] === true,
      out_of_range_acknowledged: !!ackMap[row[iId]],
      slots: slotIdx.map(function (sc, i) {
        const at = row[sc.at];
        const url = row[sc.url];
        return {
          slot: i + 1,
          at: at ? formatSheetDate_(at, 'HH:mm') : '',
          thumb: url ? driveThumbnail__(url) : '',
          completed: !!at,
        };
      }),
    });
  });
  items.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  return items;
}

function buildOwnerAckMapForPeriod_(ss, employeeId, period) {
  const out = {};
  const checkSh = ss.getSheetByName('Checkins');
  const last = checkSh.getLastRow();
  if (last < 2) return out;
  const ch = checkSh.getRange(1, 1, 1, checkSh.getLastColumn()).getValues()[0];
  const cd = checkSh.getRange(2, 1, last - 1, checkSh.getLastColumn()).getValues();
  const iId = ch.indexOf('checkin_id');
  const iEmp = ch.indexOf('employee_id');
  const iDate = ch.indexOf('checkin_date');

  const targetCheckins = {};
  cd.forEach(function (row) {
    if (row[iEmp] !== employeeId) return;
    const date = formatSheetDate_(row[iDate], 'yyyy-MM-dd');
    if (date.substring(0, 7) !== period) return;
    targetCheckins[row[iId]] = true;
  });

  const logSh = ss.getSheetByName('OwnerLogs');
  if (!logSh) return out;
  const lastLog = logSh.getLastRow();
  if (lastLog < 2) return out;
  const lh = logSh.getRange(1, 1, 1, logSh.getLastColumn()).getValues()[0];
  const ld = logSh.getRange(2, 1, lastLog - 1, logSh.getLastColumn()).getValues();
  const iAction = lh.indexOf('action');
  const iTarget = lh.indexOf('target_id');
  ld.forEach(function (row) {
    if (row[iAction] !== 'ack_out_of_range') return;
    if (!targetCheckins[row[iTarget]]) return;
    out[row[iTarget]] = true;
  });
  return out;
}

function listEmployeePaymentsForPeriod_(ss, employeeId, period) {
  const sh = ss.getSheetByName('Payments');
  ensurePaymentExtraColumns_(sh);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iPid = headers.indexOf('payment_id');
  const iEmp = headers.indexOf('employee_id');
  const iPeriod = headers.indexOf('period');
  const iBase = headers.indexOf('base_amount');
  const iExtra = headers.indexOf('extra_amount');
  const iOt = headers.indexOf('ot_amount');
  const iAmount = headers.indexOf('total_amount');
  const iStatus = headers.indexOf('status');
  const iClosed = headers.indexOf('closed_at');
  const iPaid = headers.indexOf('paid_at');
  const iAdjNote = headers.indexOf('adjustment_note');
  const iNote = headers.indexOf('note');
  const items = [];
  data.forEach(function (row) {
    if (row[iEmp] !== employeeId) return;
    if (String(row[iPeriod]).indexOf(period) !== 0) return;
    items.push({
      payment_id: row[iPid],
      period: row[iPeriod],
      base_amount: Number(row[iBase] || 0),
      extra_amount: Number(row[iExtra] || 0),
      ot_amount: Number(row[iOt] || 0),
      total_amount: Number(row[iAmount] || 0),
      status: row[iStatus],
      closed_at: row[iClosed] ? formatBangkokDateTime__(row[iClosed]) : '',
      paid_at: row[iPaid] ? formatBangkokDateTime__(row[iPaid]) : '',
      adjustment_note: iAdjNote >= 0 ? row[iAdjNote] : '',
      note: iNote >= 0 ? row[iNote] : '',
    });
  });
  return items;
}

function formatSheetDate_(value, pattern) {
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Bangkok', pattern);
  const s = String(value || '');
  if (pattern === 'yyyy-MM-dd') return s.substring(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Bangkok', pattern);
  return s;
}

function driveThumbnail__(url) {
  if (!url) return '';
  const m = String(url).match(/\/file\/d\/([^\/\?]+)/);
  if (!m) return url;
  return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400';
}
