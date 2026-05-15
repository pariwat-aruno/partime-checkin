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

    const sh = ss.getSheetByName('Payments');
    ensurePaymentExtraColumns_(sh);
    const duplicate = findPaymentForEmployeePeriod_(sh, emp.employee_id, period);
    if (duplicate) {
      return { ok: false, error: 'payment_already_closed', paymentId: duplicate.payment_id };
    }

    const extras = normalizePaymentExtras_(payload);
    const baseAmount = stats.total;
    const totalAmount = baseAmount + extras.extraAmount + extras.otAmount;

    // gen payment_id + insert
    const paymentId = nextPaymentId(period);
    appendPaymentRow_(sh, {
      payment_id: paymentId,
      employee_id: emp.employee_id,
      period: period,
      total_days_full: stats.full,
      total_days_half: stats.half,
      base_amount: baseAmount,
      extra_amount: extras.extraAmount,
      ot_amount: extras.otAmount,
      total_amount: totalAmount,
      status: 'รอจ่าย',
      closed_at: nowBangkok(),
      paid_at: '',
      adjustment_note: extras.note,
      note: payload.isResign ? 'ลาออก' : '',
    });

    logInfo('closePeriod', 'created payment', { paymentId: paymentId, employeeId: emp.employee_id, total: totalAmount });

    logOwnerAction(payload.lineUserId, 'close_period', paymentId, emp.display_name, {
      period: period,
      days_full: stats.full,
      days_half: stats.half,
      base_amount: baseAmount,
      extra_amount: extras.extraAmount,
      ot_amount: extras.otAmount,
      total: totalAmount,
      adjustment_note: extras.note,
      is_resign: !!payload.isResign,
    });

    // push สรุปหาเจ้าของทุกคน
    pushToAllOwners([{
      type: 'text',
      text: 'ปิดยอดสำเร็จ — บริษัท วอร์ด้า สกินแคร์ จำกัด\n' +
        emp.display_name + ' (' + emp.employee_id + ')\n' +
        'รอบ ' + period + '\n' +
        stats.full + ' วันเต็ม + ' + stats.half + ' วันครึ่ง = ' + formatBaht_(baseAmount) + '\n' +
        (extras.extraAmount ? 'เงินพิเศษ: ' + formatBaht_(extras.extraAmount) + '\n' : '') +
        (extras.otAmount ? 'เงิน OT: ' + formatBaht_(extras.otAmount) + '\n' : '') +
        'ยอดรวม: ' + formatBaht_(totalAmount) + '\n' +
        'สถานะ: รอจ่าย'
    }]);

    const notified = notifyEmployeePeriodClosed_(emp, period, stats, {
      paymentId: paymentId,
      baseAmount: baseAmount,
      extraAmount: extras.extraAmount,
      otAmount: extras.otAmount,
      totalAmount: totalAmount,
      note: extras.note,
    });
    if (!notified) {
      pushToAllOwners([{ type: 'text', text: 'แจ้งเตือน: ปิดยอดแล้ว แต่ส่งข้อความหาพนักงานไม่สำเร็จ\n' + emp.display_name + ' (' + emp.employee_id + ')\n' + paymentId }]);
    }

    return {
      ok: true,
      paymentId: paymentId,
      total: totalAmount,
      baseAmount: baseAmount,
      extraAmount: extras.extraAmount,
      otAmount: extras.otAmount,
      daysFull: stats.full,
      daysHalf: stats.half,
      employeeNotified: notified,
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

function normalizePaymentExtras_(payload) {
  const extraAmount = Math.max(0, Number((payload && payload.extraAmount) || 0));
  const otAmount = Math.max(0, Number((payload && payload.otAmount) || 0));
  const note = String((payload && payload.adjustmentNote) || '').trim();
  return {
    extraAmount: isFinite(extraAmount) ? extraAmount : 0,
    otAmount: isFinite(otAmount) ? otAmount : 0,
    note: note,
  };
}

function ensurePaymentExtraColumns_(sh) {
  const required = ['base_amount', 'extra_amount', 'ot_amount', 'adjustment_note'];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  required.forEach(function (h) {
    if (headers.indexOf(h) >= 0) return;
    sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
    headers.push(h);
  });
}

function appendPaymentRow_(sh, values) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(function (h) {
    return values[h] == null ? '' : values[h];
  }));
}

function findPaymentForEmployeePeriod_(sh, employeeId, period) {
  const last = sh.getLastRow();
  if (last < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const iPid = headers.indexOf('payment_id');
  const iEmp = headers.indexOf('employee_id');
  const iPeriod = headers.indexOf('period');
  const iStatus = headers.indexOf('status');
  for (let i = 0; i < data.length; i++) {
    if (data[i][iEmp] === employeeId && data[i][iPeriod] === period) {
      return {
        payment_id: data[i][iPid],
        status: data[i][iStatus],
        _rowNumber: i + 2,
      };
    }
  }
  return null;
}

function notifyEmployeePeriodClosed_(emp, period, stats, payment) {
  if (!emp || !emp.line_user_id) {
    logWarn('notifyEmployeePeriodClosed', 'employee has no line_user_id', {
      employeeId: emp && emp.employee_id,
      paymentId: payment && payment.paymentId,
    });
    return false;
  }

  try {
    const res = pushText(emp.line_user_id,
      'บริษัท วอร์ด้า สกินแคร์ จำกัด\n\n' +
      'ปิดยอดค่าจ้างเรียบร้อยแล้ว\n' +
      'รอบ: ' + period + '\n' +
      'รหัสรายการ: ' + payment.paymentId + '\n' +
      'วันเต็ม: ' + stats.full + ' วัน\n' +
      'ครึ่งวัน: ' + stats.half + ' วัน\n' +
      'ค่าแรงปกติ: ' + formatBaht_(payment.baseAmount) + '\n' +
      (payment.extraAmount ? 'เงินพิเศษ: ' + formatBaht_(payment.extraAmount) + '\n' : '') +
      (payment.otAmount ? 'เงิน OT: ' + formatBaht_(payment.otAmount) + '\n' : '') +
      (payment.note ? 'หมายเหตุ: ' + payment.note + '\n' : '') +
      'ยอดรวม: ' + formatBaht_(payment.totalAmount) + '\n' +
      'สถานะ: รอจ่าย\n\n' +
      'เมื่อบริษัทโอนเงินแล้ว ระบบจะแจ้งให้ทราบอีกครั้ง');
    return res && res.ok === true;
  } catch (err) {
    logWarn('notifyEmployeePeriodClosed', 'push failed: ' + err.message, {
      employeeId: emp.employee_id,
      paymentId: payment && payment.paymentId,
    });
    return false;
  }
}

function notifyEmployeePaid_(emp, period, total, paymentId) {
  if (!emp || !emp.line_user_id) {
    logWarn('notifyEmployeePaid', 'employee has no line_user_id', {
      employeeId: emp && emp.employee_id,
      paymentId: paymentId,
    });
    return false;
  }

  try {
    const res = pushText(emp.line_user_id,
      'บริษัท วอร์ด้า สกินแคร์ จำกัด\n\n' +
      'โอนค่าจ้างเรียบร้อยแล้ว\n' +
      'รอบ: ' + period + '\n' +
      'รหัสรายการ: ' + paymentId + '\n' +
      'ยอดโอน: ' + formatBaht_(total) + '\n' +
      'สถานะ: จ่ายแล้ว\n\n' +
      'สามารถกดเมนู "ดูยอด" เพื่อตรวจสอบสถานะล่าสุดได้');
    return res && res.ok === true;
  } catch (err) {
    logWarn('notifyEmployeePaid', 'push failed: ' + err.message, {
      employeeId: emp.employee_id,
      paymentId: paymentId,
    });
    return false;
  }
}

function formatBaht_(amount) {
  return Number(amount || 0).toLocaleString('th-TH') + ' บาท';
}
