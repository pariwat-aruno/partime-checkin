# CONTEXT.md — partime-checkin

> **สำคัญ:** AI / Claude Code ต้องอ่านไฟล์นี้ก่อนทำงานบน project นี้ทุกครั้ง
> ห้ามใช้ศัพท์ที่ไม่ตรงกับที่จดไว้ในนี้

---

## 1. Project Identity

- **ชื่อ:** `partime-checkin`
- **ชื่อไทย:** ระบบลงทะเบียน + เช็คอินพาร์ทไทม์ผ่าน LINE
- **Description:** พาร์ทไทม์ลงทะเบียนเองผ่าน LINE LIFF + เช็คอินรายวันด้วย GPS + selfie โดยเจ้าของกดอนุมัติผ่าน flex card แล้วระบบคำนวณค่าจ้างให้
- **Type:** Mini app (ไม่ใช่ enterprise)
- **Stack:** Google Sheets + Apps Script + LINE Messaging API + LIFF + n8n (optional)

---

## 2. Glossary — ศัพท์ที่ใช้ใน project นี้

| คำที่ใช้ในระบบ | คำเทคนิค (ห้ามใช้) | ความหมาย |
|---|---|---|
| พาร์ทไทม์ | employee / worker / staff | คนที่มาทำงานชั่วคราวที่ลงทะเบียนในระบบ |
| เจ้าของ | admin / owner / manager | คนเดียวที่อนุมัติและกดจ่ายเงิน (พี่ปุ้ย) |
| ลงทะเบียน | register / signup / onboarding | กรอกข้อมูลครั้งแรกผ่าน LIFF (ทำครั้งเดียว) |
| เช็คอิน | check-in / clock-in / attendance | กดปุ่มยืนยันว่ามาทำงานวันนั้น |
| อนุมัติ | approve | เจ้าของกดยืนยันว่าพาร์ทไทม์มาทำงานจริงในวันนั้น |
| ไม่อนุมัติ | reject / decline | เจ้าของกดปฏิเสธ = พาร์ทไทม์ไม่ได้มา |
| รออนุมัติ | pending | สถานะหลังเช็คอินแต่เจ้าของยังไม่กดอนุมัติ |
| เต็มวัน | full-day | วันทำงานเต็ม = ค่าจ้าง 400 บาท |
| ครึ่งวัน | half-day | วันทำงานครึ่ง = ค่าจ้าง 200 บาท (เจ้าของเป็นคน override) |
| ค่าจ้าง | wage / salary / pay | จำนวนเงินต่อวัน (เต็มวัน 400 / ครึ่งวัน 200) |
| ยอด | total / amount / payroll | ผลรวมค่าจ้างของพาร์ทไทม์ในรอบจ่าย 1 รอบ |
| รอบจ่าย | period / pay-cycle | ช่วงเวลาที่รวมยอดจ่ายเงิน (รายเดือน หรือลาออก) |
| ปิดยอด | close-period / payout | เจ้าของกดสรุปยอดของพาร์ทไทม์ในรอบนั้น |
| เงินพิเศษ | extra payment / adjustment | เงินเพิ่มนอกเหนือจากค่าแรงปกติ ใส่ตอนปิดยอด |
| เงิน OT | overtime payment | เงิน OT เพิ่มนอกเหนือจากค่าแรงปกติ ใส่ตอนปิดยอด |
| รอจ่าย | unpaid / pending-payment | สถานะหลังปิดยอดแต่ยังไม่โอนเงิน |
| จ่ายแล้ว | paid / settled | สถานะหลังเจ้าของโอนเงินและกดยืนยัน |
| รัศมีหน้างาน | geofence / radius | พื้นที่รอบร้านที่เช็คอินได้ (default 150m) |
| Flex card | (ใช้คำนี้ได้) | การ์ดที่ส่งเข้า LINE เจ้าของให้กดอนุมัติ |
| LIFF | (ใช้คำนี้ได้) | หน้าเว็บใน LINE ที่พาร์ทไทม์ใช้ลงทะเบียน/เช็คอิน/ดูยอด |

**กฎ:** ใน code, comment, doc, message ทั้งหมดให้ใช้คอลัมน์ซ้าย
ห้ามใช้คอลัมน์กลางเด็ดขาด (ตัวแปรในโค้ดใช้อังกฤษได้แต่ขอให้ map ตรง เช่น `employee` = พาร์ทไทม์)

---

## 3. Roles & Permissions

| Role | จำนวน | ทำอะไรได้ | ทำไม่ได้ |
|---|---|---|---|
| พาร์ทไทม์ | หลายคน | ลงทะเบียนตัวเอง / เช็คอิน / ดูยอดของตัวเอง | ดูข้อมูลคนอื่น / กดอนุมัติ / กดจ่าย |
| เจ้าของ | 1+ คน | กดอนุมัติ (เต็ม/ครึ่ง/ไม่อนุมัติ) / ปิดยอด / ใส่เงินพิเศษและเงิน OT / กดจ่ายแล้ว / แก้กลับเป็นรอจ่าย / ดูทุกอย่าง | — |

**กฎเข้าระบบ:**
- พาร์ทไทม์ระบุตัวตนด้วย LINE User ID (ดึงอัตโนมัติจาก LIFF) ไม่มี password
- เจ้าของอ่านจาก `owner_line_user_ids` ใน Sheet `Config` แบบ comma-separated หรือ fallback เป็น Script Properties `OWNER_LINE_USER_ID`
- LIFF API ต้องส่ง `idToken` และ Apps Script verify กับ LINE ก่อนใช้ `line_user_id` จริงจาก token
- ฝั่ง LIFF ต้องเรียก `API_URL` ให้ตรงกับ Apps Script Web App deployment ล่าสุด ไม่งั้นหน้า Owner จะขึ้น `Load failed`

---

## 4. Data Model

### Sheet: `Employees` (ทะเบียนพาร์ทไทม์)

| Column | Type | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `employee_id` | string | `EMP-0001` | running number, primary key |
| `line_user_id` | string | `U1234abcd...` | unique, ดึงจาก LIFF |
| `display_name` | string | `สมชาย ใจดี` | ชื่อ-นามสกุลที่พาร์ทไทม์กรอก |
| `phone` | string | `0812345678` | เบอร์โทร |
| `bank_name` | string | `กสิกรไทย` | ชื่อธนาคาร |
| `bank_account_no` | string | `123-4-56789-0` | เลขบัญชี |
| `bank_account_name` | string | `สมชาย ใจดี` | ชื่อบัญชี |
| `selfie_url` | string | Google Drive URL | รูป selfie ตอนลงทะเบียน (reference) |
| `id_card_url` | string | Google Drive URL | รูปบัตรประชาชน |
| `is_active` | boolean | `TRUE` | ลาออกแล้ว = `FALSE` (ห้ามเช็คอินอีก) |
| `registered_at` | datetime | `2026-05-09T10:30:00+07:00` | เวลาลงทะเบียน |

### Sheet: `Checkins` (ประวัติเช็คอินรายวัน)

| Column | Type | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `checkin_id` | string | `CHK-20260509-0001` | running, primary key |
| `employee_id` | string | `EMP-0001` | foreign key → Employees |
| `checkin_date` | date | `2026-05-09` | ใช้เช็ค duplicate ต่อวัน |
| `slot1_at` | datetime | | เวลาเช็คอิน slot 1 |
| `slot1_url` | string | Google Drive URL | selfie slot 1 |
| `slot2_at` | datetime | | เวลาเช็คอิน slot 2 |
| `slot2_url` | string | Google Drive URL | selfie slot 2 |
| `slot3_at` | datetime | | เวลาเช็คอิน slot 3 |
| `slot3_url` | string | Google Drive URL | selfie slot 3 |
| `slot4_at` | datetime | | เวลาเช็คอิน slot 4 |
| `slot4_url` | string | Google Drive URL | selfie slot 4 |
| `last_lat` | number | `13.7563` | GPS ล่าสุด |
| `last_lng` | number | `100.5018` | GPS ล่าสุด |
| `last_distance_m` | number | `45` | ระยะล่าสุดจากพิกัดร้าน (m) |
| `has_out_of_range` | boolean | `TRUE` | เคยมี slot อยู่นอกรัศมี |
| `scan_count` | number | `4` | จำนวน slot ที่สแกนแล้ว |
| `status` | enum | `pending` / `approved` / `rejected` | สถานะอนุมัติ |
| `day_type` | enum | `full` / `half` / `none` | กำหนดตอนเจ้าของกดอนุมัติ |
| `wage` | number | `400` / `200` / `0` | คำนวณตาม day_type |
| `approved_at` | datetime | nullable | เวลาที่เจ้าของกด |

### Sheet: `Payments` (รอบจ่ายเงิน)

| Column | Type | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `payment_id` | string | `PAY-202605-0001` | primary key |
| `employee_id` | string | `EMP-0001` | foreign key |
| `period` | string | `2026-05` หรือ `2026-05-resign` | รอบจ่าย |
| `total_days_full` | number | `12` | จำนวนวันเต็ม |
| `total_days_half` | number | `2` | จำนวนวันครึ่ง |
| `base_amount` | number | `5200` | ค่าแรงปกติจากวันเต็ม/ครึ่งวัน |
| `extra_amount` | number | `500` | เงินพิเศษที่เจ้าของใส่ตอนปิดยอด |
| `ot_amount` | number | `300` | เงิน OT ที่เจ้าของใส่ตอนปิดยอด |
| `total_amount` | number | `6000` | base_amount + extra_amount + ot_amount |
| `status` | enum | `รอจ่าย` / `จ่ายแล้ว` | |
| `closed_at` | datetime | | เวลาที่เจ้าของกด "ปิดยอด" |
| `paid_at` | datetime | nullable | เวลาที่เจ้าของกด "จ่ายแล้ว" |
| `adjustment_note` | string | nullable | เหตุผลของเงินพิเศษ/เงิน OT |
| `note` | string | nullable | เช่น "ลาออก" |

**กฎของ Payments:**
- 1 พาร์ทไทม์ + 1 รอบจ่าย ปิดยอดซ้ำไม่ได้
- กด `จ่ายแล้ว` แล้วระบบ push แจ้งพาร์ทไทม์
- เจ้าของแก้กลับเป็น `รอจ่าย` ได้ แต่ต้องใส่เหตุผลและระบบบันทึก OwnerLogs
- ถ้า push แจ้งพาร์ทไทม์ไม่สำเร็จ ระบบต้องแจ้งเจ้าของและ log ไว้

### Sheet: `Logs` (error log)

| Column | Type | หมายเหตุ |
|---|---|---|
| `timestamp` | datetime | |
| `level` | enum | `info` / `warn` / `error` |
| `function` | string | ชื่อ function ที่เรียก |
| `message` | string | |
| `payload` | string | JSON string ของ context |

### Sheet: `Config` (ค่าตั้งระบบ)

| Key | Value (ตัวอย่าง) | หมายเหตุ |
|---|---|---|
| `wage_full_day` | `400` | บาท/วันเต็ม |
| `wage_half_day` | `200` | บาท/ครึ่งวัน |
| `geofence_lat` | `13.7563` | พิกัดร้าน |
| `geofence_lng` | `100.5018` | พิกัดร้าน |
| `geofence_radius_m` | `150` | รัศมี m |
| `owner_line_user_ids` | `Uxxx,Uyyy` | LINE User ID เจ้าของหลายคน |
| `slot1_until` | `11:00` | ก่อนเวลานี้เป็น slot 1 |
| `slot2_until` | `13:00` | ก่อนเวลานี้เป็น slot 2 |
| `slot3_until` | `17:00` | ก่อนเวลานี้เป็น slot 3 |
| `slot1_label` | `เช้า` | ชื่อ slot |
| `slot2_label` | `ก่อนพักเที่ยง` | ชื่อ slot |
| `slot3_label` | `บ่ายโมง` | ชื่อ slot |
| `slot4_label` | `เลิกงาน` | ชื่อ slot |

### Sheet: `OwnerLogs` (บันทึกกิจกรรมเจ้าของ)

| Column | Type | หมายเหตุ |
|---|---|---|
| `timestamp` | datetime | |
| `owner_user_id` | string | LINE User ID เจ้าของที่ทำรายการ |
| `owner_name` | string | ชื่อจาก LINE profile ถ้าดึงได้ |
| `action` | enum | `approve_full` / `approve_half` / `reject` / `close_period` / `mark_paid` / `restore_pending` / `ack_out_of_range` |
| `target_id` | string | `checkin_id` หรือ `payment_id` |
| `target_name` | string | ชื่อพาร์ทไทม์ |
| `detail` | string | JSON string รายละเอียด |
| `ack_out_of_range` | — | owner กด `รับทราบ` เช็คอินนอกเขต แล้วให้ history แสดง `รับทราบแล้ว` |

---

## 5. Conventions

1. **ภาษา:** Comment ใน code = ไทย, ตัวแปร/function = อังกฤษ
2. **Error handling:** ทุก function ของ Apps Script ต้อง try-catch + log ลง Sheet `Logs`
3. **Idempotent:** เช็คอินซ้ำ slot เดิมในวันเดียวกัน = ไม่ overwrite, ปิดยอดซ้ำรอบเดิม = block
4. **Timeout:** Apps Script function ต้องจบภายใน 6 นาที
5. **Secrets:** ใส่ใน Script Properties (`LINE_CHANNEL_ACCESS_TOKEN`, `OWNER_LINE_USER_ID`, `SHEET_ID`, `LIFF_ID`) ห้ามใส่ใน code; ฝั่ง LIFF เก็บ `API_URL` ใน config และต้องตรงกับ Web App deployment ล่าสุด
6. **Time zone:** ทุก datetime เก็บเป็น `Asia/Bangkok` (ISO 8601 พร้อม offset `+07:00`)
7. **ID format:**
   - Employees: `EMP-XXXX` (4 หลัก running)
   - Checkins: `CHK-YYYYMMDD-XXXX`
   - Payments: `PAY-YYYYMM-XXXX`
8. **Image storage:** อัพรูปลง Google Drive folder เดียวกับ Sheet → เก็บ URL ลง Sheet (ห้ามเก็บ base64 ในเซลล์)
9. **GPS check:** ใช้สูตร haversine คำนวณระยะ ถ้าเกิน `geofence_radius_m` → บันทึกได้แต่ flag ให้เจ้าของพิจารณา
10. **Duplicate detection:** เช็ค `line_user_id` ซ้ำตอนลงทะเบียน (1 LINE = 1 พาร์ทไทม์)

---

## 6. ห้ามทำ (Out of Scope)

- ❌ Authentication เกินกว่า LINE Login
- ❌ Real-time websocket / push อัพเดต UI
- ❌ Mobile native app
- ❌ Custom domain / SSL ของตัวเอง (ใช้ apps.googleapis.com / liff.line.me)
- ❌ เปลี่ยน stack เป็น Firebase / Supabase / AWS / database ตัวอื่น
- ❌ OCR / face matching อัตโนมัติ (เจ้าของดูเทียบเอง)
- ❌ Multi-location / หลายสาขา (รัศมีเดียว 1 จุด)
- ❌ คำนวณภาษี / หัก ณ ที่จ่าย / ส่งเงินอัตโนมัติ
- ❌ Export PDF payslip (Phase 2)

ถ้าผู้ใช้ขอเหล่านี้ → ตอบว่า "ออก scope mini app แล้ว phase 2"

---

## 7. ขั้นต่อไป

หลัง CONTEXT.md เสร็จแล้ว:
1. Copy ไฟล์นี้ไปวาง GitHub repo root (ตั้งชื่อว่า `CONTEXT.md`)
2. ใช้ skill `mini-app-architect` ออกแบบ architecture (มี architecture.md ในโฟลเดอร์นี้แล้ว)
3. ใช้ skill `mini-app-tasks` ตัด TODO ส่ง Claude Code (มี TASKS.md ในโฟลเดอร์นี้แล้ว)
