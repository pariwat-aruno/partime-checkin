/**
 * Register.gs — flow A handler (TASK-15)
 *
 * input: {
 *   lineUserId, displayName, phone,
 *   bankName, bankAccountNo, bankAccountName,
 *   selfieBase64, idCardBase64
 * }
 *
 * output: { ok: true, employeeId } | { ok: false, error: '...' }
 */

function register(payload) {
  const required = [
    'lineUserId', 'displayName', 'phone',
    'bankName', 'bankAccountNo', 'bankAccountName',
    'selfieBase64', 'idCardBase64',
  ];
  const missing = required.filter(function (k) { return !payload || !payload[k]; });
  if (missing.length) {
    return { ok: false, error: 'missing_fields', detail: missing };
  }

  // เช็ค line_user_id ซ้ำ
  const existing = findEmployeeByLineUserId(payload.lineUserId);
  if (existing) {
    logInfo('register', 'duplicate line_user_id', { lineUserId: payload.lineUserId, employeeId: existing.employee_id });
    return { ok: false, error: 'already_registered', employeeId: existing.employee_id };
  }

  // upload รูป 2 ใบ
  const ts = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
  let selfieUrl, idCardUrl;
  try {
    selfieUrl = uploadImage(payload.selfieBase64, 'selfie-' + ts + '.jpg', 'selfies');
    idCardUrl = uploadImage(payload.idCardBase64, 'idcard-' + ts + '.jpg', 'id-cards');
  } catch (err) {
    logError('register', 'upload failed: ' + err.message, { lineUserId: payload.lineUserId });
    return { ok: false, error: 'upload_failed', detail: err.message };
  }

  // gen employee_id + insert
  const employeeId = nextEmployeeId();
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Employees');
  // header order: employee_id, line_user_id, display_name, phone, bank_name, bank_account_no, bank_account_name, selfie_url, id_card_url, is_active, registered_at
  sh.appendRow([
    employeeId,
    payload.lineUserId,
    payload.displayName,
    payload.phone,
    payload.bankName,
    payload.bankAccountNo,
    payload.bankAccountName,
    selfieUrl,
    idCardUrl,
    true,
    nowBangkok(),
  ]);

  logInfo('register', 'created employee', { employeeId: employeeId, lineUserId: payload.lineUserId });

  // welcome message หาผู้ลงทะเบียน
  pushText(payload.lineUserId,
    'ยินดีต้อนรับสู่ บริษัท วอร์ด้า สกินแคร์ จำกัด\n' +
    payload.displayName + ' (' + employeeId + ')\n\n' +
    'ลงทะเบียนเรียบร้อย กดเมนู "เช็คอิน" ตอนถึงร้านได้เลย');

  // push card หา owner ทุกคน — แจ้งว่ามีพาร์ทไทม์ใหม่
  try {
    const card = buildRegistrationCard({
      employeeId: employeeId,
      displayName: payload.displayName,
      phone: payload.phone,
      bankName: payload.bankName,
      bankAccountNo: payload.bankAccountNo,
      bankAccountName: payload.bankAccountName,
      selfieUrl: selfieUrl,
      idCardUrl: idCardUrl,
    });
    pushToAllOwners([card]);
  } catch (err) {
    logError('register', 'push owner notification failed: ' + err.message, { employeeId: employeeId });
  }

  return { ok: true, employeeId: employeeId };
}
