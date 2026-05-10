// Config — แก้ค่าให้ตรงกับ LINE Developers ของจริง
//
// LIFF_ID หาได้จาก LINE Developers Console → channel → tab LIFF
// API_URL คือ Web App URL ของ Apps Script (ลงท้าย /exec)

export const CONFIG = {
  // LIFF IDs
  LIFF_ID_REGISTER: '2010027935-yGV4yPSO',
  LIFF_ID_CHECKIN:  '2010027935-VNfQm4KC',
  LIFF_ID_BALANCE:  '2010027935-GqOSphZC',
  LIFF_ID_ADMIN:    '',  // ⚠️ ต้องสร้าง LIFF app ใหม่ใน LINE Developers + ใส่ ID ตรงนี้

  // Apps Script Web App URL — POST endpoint ของ backend
  API_URL: 'https://script.google.com/macros/s/AKfycbzfhvs91IrzAW_L9UfNbGM5ndR-Wb2tfkNO4qeATMbzpol6vmeoVUt0u4Ro5n2wY0KIPQ/exec',

  // dev mode — true = mock LIFF (ทดสอบใน browser ปกติ ไม่ผ่าน LINE)
  DEV_MOCK_LIFF: false,
  DEV_MOCK_USER_ID: 'U_DEV_TEST',
};
