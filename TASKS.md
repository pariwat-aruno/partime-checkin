# TASKS.md — partime-checkin

> **สำคัญ:** Claude Code อ่านไฟล์นี้คู่กับ [CONTEXT.md](CONTEXT.md) + [docs/architecture.md](docs/architecture.md)
> ทำทีละ task ตามลำดับ ห้ามทำพร้อมกัน

## วิธีใช้

1. หยิบ task แรกที่ยังไม่ติ๊ก
2. อ่าน acceptance criteria ให้เข้าใจ
3. Implement
4. ทดสอบตาม criteria
5. ติ๊ก ✅ แล้วไป task ถัดไป

ห้ามข้าม dependency — ถ้า TASK ใด require อีก task ต้องเสร็จก่อน

---

## Phase 1: Setup ฐานข้อมูล + storage

### TASK-01: สร้าง Google Sheet + 5 sheet
- **ทำ:** สร้าง spreadsheet ใหม่ ตั้งชื่อ `partime-checkin-db` แล้วสร้าง 5 sheet ตาม CONTEXT § 4
- **Acceptance:**
  - [ ] sheet `Employees` มี header 11 column ตรงตาม CONTEXT
  - [ ] sheet `Checkins` มี header 12 column
  - [ ] sheet `Payments` มี header หลักและรองรับ column เงินพิเศษ/OT (`base_amount`, `extra_amount`, `ot_amount`, `adjustment_note`)
  - [ ] sheet `Logs` มี header 5 column
  - [ ] sheet `Config` มี 2 column (key, value)
  - [ ] copy Sheet ID เก็บไว้ใช้ TASK-09
- **Depends on:** —

### TASK-02: เพิ่มค่าเริ่มต้นใน Sheet `Config`
- **ทำ:** ใส่ row ตามนี้ใน sheet `Config`
- **Acceptance:**
  - [ ] `wage_full_day` = `400`
  - [ ] `wage_half_day` = `200`
  - [ ] `geofence_lat` = พิกัดร้านจริง (ถามเจ้าของ)
  - [ ] `geofence_lng` = พิกัดร้านจริง
  - [ ] `geofence_radius_m` = `150`
- **Depends on:** TASK-01

### TASK-03: สร้าง Google Drive folder
- **ทำ:** สร้าง folder `partime-checkin-images` + 3 sub-folder
- **Acceptance:**
  - [ ] folder `selfies/`, `id-cards/`, `daily-checkins/` พร้อม
  - [ ] permission = ใครมี link ดูได้ (Anyone with link)
  - [ ] copy Drive folder ID เก็บไว้
- **Depends on:** —

---

## Phase 2: LINE setup

### TASK-04: สร้าง LINE Official Account + Channel
- **ทำ:** สร้าง LINE OA ใน LINE Developers + เปิด Messaging API channel
- **Acceptance:**
  - [ ] มี Channel Access Token (long-lived)
  - [ ] มี Channel Secret
  - [ ] เปิด webhook พร้อม
- **Depends on:** —

### TASK-05: สร้าง LIFF app 3 endpoint
- **ทำ:** สร้าง 3 LIFF app ใน channel เดียวกัน (size: full)
- **Acceptance:**
  - [ ] `liff-register` URL → `https://[host]/register`
  - [ ] `liff-checkin` URL → `https://[host]/checkin`
  - [ ] `liff-balance` URL → `https://[host]/balance`
  - [ ] ทุก LIFF เปิด permission `profile`, `openid`
  - [ ] `liff-checkin` เปิด permission `geolocation`
  - [ ] copy LIFF ID ทั้ง 3 ตัว
- **Depends on:** TASK-04

### TASK-06: สร้าง rich menu
- **ทำ:** ออกแบบ rich menu 3 ปุ่ม ผ่าน LINE Manager หรือ Messaging API
- **Acceptance:**
  - [ ] ปุ่ม 1: "ลงทะเบียน" → URI action `https://liff.line.me/[liff-register-id]`
  - [ ] ปุ่ม 2: "เช็คอิน" → URI action `https://liff.line.me/[liff-checkin-id]`
  - [ ] ปุ่ม 3: "ดูยอด" → URI action `https://liff.line.me/[liff-balance-id]`
  - [ ] ตั้งเป็น default rich menu
- **Depends on:** TASK-05

---

## Phase 3: Apps Script — Foundation

### TASK-07: สร้าง Apps Script project + เชื่อมกับ Sheet
- **ทำ:** เปิด Sheet (TASK-01) → Extensions → Apps Script → ตั้งชื่อ `partime-checkin-backend`
- **Acceptance:**
  - [ ] Script editor เปิดได้
  - [ ] มี `Code.gs` empty
- **Depends on:** TASK-01

### TASK-08: ตั้ง Script Properties
- **ทำ:** Project Settings → Script Properties → เพิ่ม 7 keys
- **Acceptance:**
  - [ ] `SHEET_ID` = ID จาก TASK-01
  - [ ] `DRIVE_FOLDER_ID` = ID จาก TASK-03
  - [ ] `LINE_CHANNEL_ACCESS_TOKEN` = token จาก TASK-04
  - [ ] `LINE_CHANNEL_SECRET` = secret จาก TASK-04
  - [ ] `OWNER_LINE_USER_ID` = LINE userId ของเจ้าของ
  - [ ] `LIFF_ID_REGISTER`, `LIFF_ID_CHECKIN`, `LIFF_ID_BALANCE`
- **Depends on:** TASK-01, TASK-03, TASK-04, TASK-05

### TASK-09: เขียน `Config.gs` — getConfig + readConfig
- **ทำ:** function อ่าน Script Properties + อ่าน sheet `Config`
- **Acceptance:**
  - [ ] `getConfig()` return object ครบทุก property
  - [ ] `readConfig()` อ่านค่า wage / geofence จาก sheet `Config`
  - [ ] throw error ชัดเจนถ้าค่าหายไป
- **Depends on:** TASK-08

### TASK-10: เขียน `Logger.gs` — logInfo / logError
- **ทำ:** helper เขียน log ลง sheet `Logs`
- **Acceptance:**
  - [ ] `logInfo(fnName, msg, payload)` เขียน level=info
  - [ ] `logError(fnName, msg, payload)` เขียน level=error + console.error
  - [ ] timestamp เป็น `Asia/Bangkok` ISO 8601
- **Depends on:** TASK-09

### TASK-11: เขียน `Utils.gs` — haversine + IDs
- **ทำ:** helper พื้นฐาน
- **Acceptance:**
  - [ ] `haversineMeters(lat1, lng1, lat2, lng2)` return ระยะเป็นเมตร (มี unit test ในคอมเมนต์)
  - [ ] `nextEmployeeId()` return `EMP-XXXX` (4 หลัก running จาก sheet)
  - [ ] `nextCheckinId(date)` return `CHK-YYYYMMDD-XXXX`
  - [ ] `nextPaymentId(period)` return `PAY-YYYYMM-XXXX`
  - [ ] `nowBangkok()` return ISO 8601 string พร้อม `+07:00`
- **Depends on:** TASK-10

### TASK-12: เขียน `LineApi.gs` — pushLine + replyLine
- **ทำ:** wrapper เรียก LINE Messaging API
- **Acceptance:**
  - [ ] `pushMessage(userId, messages[])` POST `/v2/bot/message/push`
  - [ ] `replyMessage(replyToken, messages[])` POST `/v2/bot/message/reply`
  - [ ] retry 3 ครั้ง exponential backoff (1s, 2s, 4s)
  - [ ] log error ทุกครั้งที่ fail
- **Depends on:** TASK-11

### TASK-13: เขียน `DriveStore.gs` — uploadImage
- **ทำ:** รับ base64 → upload Google Drive → return URL
- **Acceptance:**
  - [ ] `uploadImage(base64, filename, subfolder)` return public URL
  - [ ] เลือก subfolder ระหว่าง `selfies` / `id-cards` / `daily-checkins`
  - [ ] permission = anyone with link, viewer
  - [ ] handle invalid base64 → throw + log
- **Depends on:** TASK-11

---

## Phase 4: Apps Script — Endpoints

### TASK-14: เขียน `WebApp.gs` — doPost router
- **ทำ:** entry point รับทุก request จาก LIFF + LINE webhook
- **Acceptance:**
  - [ ] อ่าน `e.postData.contents` parse JSON
  - [ ] route ตาม `action` field: `register` / `checkin` / `getBalance` / LINE webhook events
  - [ ] return `ContentService.createTextOutput(JSON)` เสมอ
  - [ ] ทุก error จาก downstream → catch + log + return `{ok:false, error:msg}`
- **Depends on:** TASK-12, TASK-13

### TASK-15: เขียน `Register.gs` — register()
- **ทำ:** flow A handler
- **Acceptance:**
  - [ ] รับ `{lineUserId, displayName, phone, bankName, bankAccountNo, bankAccountName, selfieBase64, idCardBase64}`
  - [ ] เช็ค `lineUserId` ซ้ำใน `Employees` → ถ้าซ้ำ return `{ok:false, error:"already_registered"}`
  - [ ] validate field ครบ ไม่งั้น throw
  - [ ] upload 2 รูปลง Drive
  - [ ] gen `employee_id` แล้ว insert row
  - [ ] push welcome text กลับพาร์ทไทม์
  - [ ] return `{ok:true, employeeId}`
- **Depends on:** TASK-14

### TASK-16: เขียน `Checkin.gs` — checkin()
- **ทำ:** flow B handler
- **Acceptance:**
  - [ ] รับ `{lineUserId, lat, lng, selfieBase64}`
  - [ ] หา employee จาก `lineUserId` → ถ้าไม่เจอ return `{ok:false, error:"not_registered"}`
  - [ ] เช็ค `is_active=FALSE` → return `{ok:false, error:"inactive"}`
  - [ ] คำนวณ haversine vs config → ถ้าเกิน radius return `{ok:false, error:"out_of_range", distanceM}`
  - [ ] เช็ค duplicate (employee_id + checkin_date วันนี้) → ถ้ามีแล้ว return แถวเดิม `{ok:true, duplicated:true}`
  - [ ] upload selfie → Drive
  - [ ] insert row status=`pending`, day_type=`null`, wage=`0`
  - [ ] push flex card หา `OWNER_LINE_USER_ID` (TASK-18) พร้อมปุ่ม `รับทราบ` ถ้า `out_of_range`
  - [ ] return `{ok:true, checkinId}`
- **Depends on:** TASK-14, TASK-18

### TASK-17: เขียน `Balance.gs` — getBalance()
- **ทำ:** flow D handler (พาร์ทไทม์ดูยอด)
- **Acceptance:**
  - [ ] รับ `{lineUserId}` จาก LIFF idToken ที่ backend verify แล้ว
  - [ ] หา employee
  - [ ] sum wage จาก `Checkins` ที่ `status=approved` + `checkin_date` ในเดือนปัจจุบัน
  - [ ] count `pending` วันที่ค้างอยู่
  - [ ] อ่านรอบที่แล้วจาก `Payments`
  - [ ] return `{ok:true, currentMonth:{full, half, total}, pendingDays, lastPayment:{period, base, extra, ot, total, status}}`
- **Depends on:** TASK-14

### TASK-18: เขียน `FlexCard.gs` — buildApprovalCard
- **ทำ:** สร้าง flex JSON สำหรับให้เจ้าของกด
- **Acceptance:**
  - [ ] รับ `{checkinId, displayName, phone, selfieUrl, referenceSelfieUrl, checkinAt, distanceM}`
  - [ ] return flex JSON 2 ภาพ (รูปวันนั้น vs reference) + ข้อมูลข้อความ
  - [ ] 3 ปุ่ม postback: `action=approve&id=...&type=full` / `type=half` / `action=reject&id=...`
- **Depends on:** TASK-12

### TASK-19: เขียน `WebApp.gs` — handlePostback
- **ทำ:** flow C handler (เจ้าของกดปุ่มใน flex)
- **Acceptance:**
  - [ ] รับ event type=postback จาก LINE webhook
  - [ ] verify `replyToken` มาจาก `OWNER_LINE_USER_ID` เท่านั้น (block คนอื่น)
  - [ ] parse `action` + `id` + `type`
  - [ ] update row ใน `Checkins`:
    - approve full → `status=approved, day_type=full, wage=400`
    - approve half → `status=approved, day_type=half, wage=200`
    - reject → `status=rejected, day_type=none, wage=0`
  - [ ] reply text confirm "อนุมัติเรียบร้อย — [ชื่อ] [วันที่] [400/200/ไม่อนุมัติ]"
- **Depends on:** TASK-14, TASK-18

### TASK-20: เขียน `Payment.gs` — closePeriod()
- **ทำ:** flow D handler (เจ้าของปิดยอด)
- **Acceptance:**
  - [ ] รับ `{employeeId, period, isResign, extraAmount, otAmount, adjustmentNote}` จาก Owner LIFF
  - [ ] sum approved checkins ในช่วง period
  - [ ] count วัน pending → ถ้ามี > 0 และยังไม่ confirm ให้ return `has_pending`
  - [ ] block duplicate employee+period ด้วย `payment_already_closed`
  - [ ] insert row `Payments` status=`รอจ่าย` พร้อม `closed_at`, `base_amount`, `extra_amount`, `ot_amount`, `total_amount`, `adjustment_note`
  - [ ] note=`ลาออก` ถ้า `isResign=true`
  - [ ] push สรุปยอดหาเจ้าของ
  - [ ] push แจ้งพาร์ทไทม์ว่าปิดยอดแล้วและสถานะ `รอจ่าย`
  - [ ] ถ้า push หาพาร์ทไทม์ไม่สำเร็จ ให้ log และแจ้ง owner
- **Depends on:** TASK-19

### TASK-20B: เขียน payment actions เพิ่มเติม
- **ทำ:** action สำหรับ owner กดจ่ายแล้ว / แก้กลับเป็นรอจ่าย / ดูประวัติรายคน
- **Acceptance:**
  - [ ] `markPaid({paymentId})` เปลี่ยน status=`จ่ายแล้ว`, set `paid_at`, push แจ้งพาร์ทไทม์
  - [ ] `markPaid` ไม่ส่งซ้ำถ้า status เป็น `จ่ายแล้ว` อยู่แล้ว
  - [ ] `restorePaymentPending({paymentId, reason})` เปลี่ยน status กลับเป็น `รอจ่าย`, clear `paid_at`, log เหตุผลใน `OwnerLogs`
  - [ ] `getEmployeeHistory({employeeId, period})` return checkins + payments ของพาร์ทไทม์รายคน
  - [ ] `ack_out_of_range({checkinId})` log owner ว่ารับทราบรายการนอกเขต
  - [ ] ทุก action verify owner จาก LIFF idToken
- **Depends on:** TASK-20

---

## Phase 5: LIFF Frontend

### TASK-21: เขียน `liff-register/index.html`
- **ทำ:** หน้าฟอร์มลงทะเบียน
- **Acceptance:**
  - [ ] โหลด LIFF SDK + init ด้วย `LIFF_ID_REGISTER`
  - [ ] ฟอร์ม 6 field: ชื่อ, เบอร์, ธนาคาร, เลขบัญชี, ชื่อบัญชี + 2 file input (selfie, บัตรประชาชน)
  - [ ] resize รูปฝั่ง client ให้ width ≤ 1280px ก่อน base64
  - [ ] กด submit → `liff.getProfile()` ดึง userId → POST Apps Script
  - [ ] แสดง loading + success / error UI
  - [ ] ถ้าได้ `already_registered` → แสดงข้อความ + ปุ่ม "ปิด"
- **Depends on:** TASK-15

### TASK-22: เขียน `liff-checkin/index.html`
- **ทำ:** หน้าเช็คอิน
- **Acceptance:**
  - [ ] โหลด LIFF SDK + init ด้วย `LIFF_ID_CHECKIN`
  - [ ] ขอ permission location → ถ้าปิด → แสดง "ต้องเปิด GPS"
  - [ ] เปิดกล้อง `<input type=file capture=user>` (กล้องหน้า)
  - [ ] กด "ยืนยัน" → ดึง lat/lng + base64 + userId → POST
  - [ ] handle response: ok → "รออนุมัติจากเจ้าของ", out_of_range → "อยู่นอกพื้นที่ (ระยะ X m)"
  - [ ] handle duplicate → "วันนี้เช็คอินแล้ว"
- **Depends on:** TASK-16

### TASK-23: เขียน `liff-balance/index.html`
- **ทำ:** หน้าดูยอด
- **Acceptance:**
  - [ ] โหลด LIFF SDK + init ด้วย `LIFF_ID_BALANCE`
  - [ ] ดึง userId → POST `getBalance`
  - [ ] แสดง: เดือนนี้ X วันเต็ม + Y ครึ่งวัน = Z บาท
  - [ ] แสดง: รออนุมัติ N วัน
  - [ ] แสดง: รอบที่แล้ว — ยอด + breakdown เงินพิเศษ/OT + สถานะ (รอจ่าย/จ่ายแล้ว)
- **Depends on:** TASK-17

### TASK-24: Host LIFF frontend
- **ทำ:** เลือก 1 วิธี — (a) GitHub Pages, (b) Netlify, (c) เก็บ HTML ใน Apps Script เป็น `HtmlService`
- **Acceptance:**
  - [ ] 3 หน้า HTML deploy ที่ public URL
  - [ ] LIFF endpoint URL ใน LINE Developers อัปเดตให้ตรง URL จริง
  - [ ] `API_URL` ใน frontend ชี้ไป Web App deployment ล่าสุด
- **Depends on:** TASK-21, TASK-22, TASK-23

---

## Phase 6: Deploy + ทดสอบ end-to-end

### TASK-25: Deploy Apps Script เป็น Web App
- **ทำ:** Deploy → New deployment → Web app
- **Acceptance:**
  - [ ] Execute as: Me
  - [ ] Who has access: Anyone / anonymous
  - [ ] copy Web App URL
  - [ ] paste URL ใน LINE Developers → Webhook URL
  - [ ] กดปุ่ม "Verify" ใน LINE — ต้องได้ success
  - [ ] หน้า Owner เปิดได้โดยไม่ขึ้น `Load failed`
  - [ ] ปุ่ม `ประวัติ` เรียก action ล่าสุดได้ ไม่เจอ `unknown_action`
- **Depends on:** TASK-14 ถึง TASK-20

### TASK-26: Test Flow A (ลงทะเบียน)
- **ทำ:** ใช้ dummy account 1 คน
- **Acceptance:**
  - [ ] ลงทะเบียนผ่าน
  - [ ] row เพิ่มใน `Employees` ครบ 11 column
  - [ ] รูป 2 รูปอัพ Drive ดูได้
  - [ ] ลงทะเบียนซ้ำ → ถูก block

### TASK-27: Test Flow B (เช็คอิน)
- **ทำ:** ทดสอบ 4 เคส
- **Acceptance:**
  - [ ] อยู่ในรัศมี → ผ่าน + flex card ถึงเจ้าของ
  - [ ] อยู่นอกรัศมี → ปฏิเสธ + แจ้ง distance
  - [ ] เช็คอินซ้ำวันเดียวกัน → return แถวเดิม ไม่สร้างใหม่
  - [ ] ปิด GPS → LIFF block ไม่ส่ง request

### TASK-28: Test Flow C (อนุมัติ)
- **ทำ:** เจ้าของกดทั้ง 3 ปุ่ม
- **Acceptance:**
  - [ ] อนุมัติเต็มวัน → status=approved, day_type=full, wage=400
  - [ ] อนุมัติครึ่งวัน → wage=200
  - [ ] ไม่อนุมัติ → status=rejected, wage=0
  - [ ] reply confirm กลับเจ้าของทุกครั้ง

### TASK-29: Test Flow D (ดูยอด + ปิดยอด)
- **ทำ:** ทดสอบหลังมี data > 5 วัน
- **Acceptance:**
  - [ ] LIFF "ดูยอด" แสดงตัวเลขถูก
  - [ ] ปิดยอดเดือนนี้ → row `Payments` เพิ่ม status=รอจ่าย พร้อม base/extra/OT/total
  - [ ] ปิดยอดตอนมี pending → เตือนเจ้าของ
  - [ ] ปิดยอดซ้ำรอบเดิม → block
  - [ ] owner กดจ่ายแล้ว → status=`จ่ายแล้ว`, พาร์ทไทม์ได้รับ LINE แจ้ง
  - [ ] owner กดแก้เป็นรอจ่าย → status=`รอจ่าย`, clear paid_at, มี OwnerLogs
  - [ ] หน้า Owner ปุ่มประวัติแสดง checkins + payments รายคน
  - [ ] เช็คอินนอกเขตที่ owner กดรับทราบแล้ว แสดง `รับทราบแล้ว` ในประวัติ

---

## Definition of Done (ของทั้ง project)

- [ ] ทุก task ติ๊กครบ
- [ ] Test ทั้ง 4 flow ผ่าน + edge cases ผ่าน
- [ ] CONTEXT.md ตรงกับ implementation จริง (ถ้ามีเปลี่ยน → อัปเดตก่อน)
- [ ] architecture.md อัปเดตตามที่เปลี่ยนแปลงระหว่าง build
- [ ] frontend `API_URL` และ Apps Script Web App deployment ตรงกัน
- [ ] commit + push GitHub แล้ว
- [ ] ส่ง URL rich menu ให้พาร์ทไทม์เพิ่มเป็น friend ได้
