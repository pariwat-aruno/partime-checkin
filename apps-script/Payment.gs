/**
 * Payment.gs — flow D handler (เจ้าของปิดยอด) (TASK-20)
 *
 * input: { employeeId, period?, isResign? }
 *   period default = เดือนปัจจุบัน (yyyy-MM)
 *   isResign=true → period = '<yyyy-MM>-resign', note = 'ลาออก'
 *
 * output: { ok: true, paymentId, total, daysFull, daysHalf, pendingWarning? }
 */

function closePeriod(payload) {
  if (!payload || !payload.employeeId) {
    return { ok: false, error: 'missing_fields' };
  }
  // owner only
  if (!isOwner(payload.lineUserId)) {
    return { ok: false, error: 'not_owner' };
  }
  const emp = findEmployeeById_(payload.employeeId);
  if (!emp) return { ok: false, error: 'employee_not_found' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'busy_try_again' };
  }

  try {
    const baseMonth = payload.period || thisMonthBangkok();
    const period = payload.isResign ? (baseMonth + '-resign') : baseMonth;

    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);

    // sum approved + count pending ในเดือน
    const stats = sumApprovedAndPending_(ss, emp.employee_id, baseMonth);

    // ถ้ามี pending → return warning ไม่สร้างแถว (เจ้าของต้อง confirm รอบสอง)
    if (stats.pending > 0 && !payload.confirm) {
      pushToAllOwners([{
        type: 'text',
        text: 'เตือนปิดยอด — ' + emp.display_name + ' (' + emp.employee_id + ')\n' +
          'ยังมี ' + stats.pending + ' วันที่รออนุมัติ\n' +
          'ถ้าจะปิดเลย ส่ง action ใหม่พร้อม confirm=true'
      }]);
      return { ok: false, error: 'has_pending', pending: stats.pending };
    }

    // gen payment_id + insert
    const paymentId = nextPaymentId(period);
    const sh = ss.getSheetByName('Payments');
    // header: payment_id, employee_id, period, total_days_full, total_days_half, total_amount, status, closed_at, paid_at, note
    sh.appendRow([
      paymentId,
      emp.employee_id,
      period,
      stats.full,
      stats.half,
      stats.total,
      'รอจ่าย',
      nowBangkok(),
      '',
      payload.isResign ? 'ลาออก' : '',
    ]);

    logInfo('closePeriod', 'created payment', { paymentId: paymentId, employeeId: emp.employee_id, total: stats.total });

    logOwnerAction(payload.lineUserId, 'close_period', paymentId, emp.display_name, {
      period: period,
      days_full: stats.full,
      days_half: stats.half,
      total: stats.total,
      is_resign: !!payload.isResign,
    });

    // push สรุปหาเจ้าของทุกคน
    pushToAllOwners([{
      type: 'text',
      text: 'ปิดยอดสำเร็จ — บริษัท วอร์ด้า สกินแคร์ จำกัด\n' +
        emp.display_name + ' (' + emp.employee_id + ')\n' +
        'รอบ ' + period + '\n' +
        stats.full + ' วันเต็ม + ' + stats.half + ' วันครึ่ง = ' + stats.total + ' บาท\n' +
        'สถานะ: รอจ่าย'
    }]);

    notifyEmployeePeriodClosed_(emp, period, stats, paymentId);

    return {
      ok: true,
      paymentId: paymentId,
      total: stats.total,
      daysFull: stats.full,
      daysHalf: stats.half,
    };
  } finally {
    lock.releaseLock();
  }
}

function findEmployeeById_(employeeId) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Employees');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const idx = headers.indexOf('employee_id');
  for (let i = 0; i < data.length; i++) {
    if (data[i][idx] === employeeId) {
      const row = {};
      headers.forEach(function (h, j) { row[h] = data[i][j]; });
      row._rowNumber = i + 2;
      return row;
    }
  }
  return null;
}

function sumApprovedAndPending_(ss, employeeId, monthStr) {
  const sh = ss.getSheetByName('Checkins');
  const last = sh.getLastRow();
  if (last < 2) return { full: 0, half: 0, total: 0, pending: 0 };
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iEmp = headers.indexOf('employee_id');
  const iDate = headers.indexOf('checkin_date');
  const iStatus = headers.indexOf('status');
  const iDayType = headers.indexOf('day_type');
  const iWage = headers.indexOf('wage');

  let full = 0, half = 0, total = 0, pending = 0;
  data.forEach(function (row) {
    if (row[iEmp] !== employeeId) return;
    const d = row[iDate];
    const ym = (d instanceof Date)
      ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM')
      : String(d).substring(0, 7);
    if (ym !== monthStr) return;
    if (row[iStatus] === 'approved') {
      if (row[iDayType] === 'full') full++;
      if (row[iDayType] === 'half') half++;
      total += Number(row[iWage] || 0);
    } else if (row[iStatus] === 'pending') {
      pending++;
    }
  });
  return { full: full, half: half, total: total, pending: pending };
}

function notifyEmployeePeriodClosed_(emp, period, stats, paymentId) {
  if (!emp || !emp.line_user_id) {
    logWarn('notifyEmployeePeriodClosed', 'employee has no line_user_id', {
      employeeId: emp && emp.employee_id,
      paymentId: paymentId,
    });
    return;
  }

  try {
    pushText(emp.line_user_id,
      'บริษัท วอร์ด้า สกินแคร์ จำกัด\n\n' +
      'ปิดยอดค่าจ้างเรียบร้อยแล้ว\n' +
      'รอบ: ' + period + '\n' +
      'รหัสรายการ: ' + paymentId + '\n' +
      'วันเต็ม: ' + stats.full + ' วัน\n' +
      'ครึ่งวัน: ' + stats.half + ' วัน\n' +
      'ยอดรวม: ' + formatBaht_(stats.total) + '\n' +
      'สถานะ: รอจ่าย\n\n' +
      'เมื่อบริษัทโอนเงินแล้ว ระบบจะแจ้งให้ทราบอีกครั้ง');
  } catch (err) {
    logWarn('notifyEmployeePeriodClosed', 'push failed: ' + err.message, {
      employeeId: emp.employee_id,
      paymentId: paymentId,
    });
  }
}

function notifyEmployeePaid_(emp, period, total, paymentId) {
  if (!emp || !emp.line_user_id) {
    logWarn('notifyEmployeePaid', 'employee has no line_user_id', {
      employeeId: emp && emp.employee_id,
      paymentId: paymentId,
    });
    return;
  }

  try {
    pushText(emp.line_user_id,
      'บริษัท วอร์ด้า สกินแคร์ จำกัด\n\n' +
      'โอนค่าจ้างเรียบร้อยแล้ว\n' +
      'รอบ: ' + period + '\n' +
      'รหัสรายการ: ' + paymentId + '\n' +
      'ยอดโอน: ' + formatBaht_(total) + '\n' +
      'สถานะ: จ่ายแล้ว\n\n' +
      'สามารถกดเมนู "ดูยอด" เพื่อตรวจสอบสถานะล่าสุดได้');
  } catch (err) {
    logWarn('notifyEmployeePaid', 'push failed: ' + err.message, {
      employeeId: emp.employee_id,
      paymentId: paymentId,
    });
  }
}

function formatBaht_(amount) {
  return Number(amount || 0).toLocaleString('th-TH') + ' บาท';
}
