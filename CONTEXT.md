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
| เจ้าของ | 1 คน | กดอนุมัติ (เต็ม/ครึ่ง/ไม่อนุมัติ) / ปิดยอด / กดจ่ายแล้ว / ดูทุกอย่าง | — |

**กฎเข้าระบบ:**
- พาร์ทไทม์ระบุตัวตนด้วย LINE User ID (ดึงอัตโนมัติจาก LIFF) ไม่มี password
- เจ้าของเป็น LINE User ID เดียวที่ระบุไว้ใน Script Properties (`OWNER_LINE_USER_ID`) — flex card ส่งหาคนนี้คนเดียว

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
| `checkin_at` | datetime | `2026-05-09T08:15:23+07:00` | เวลาที่กดเช็คอิน |
| `lat` | number | `13.7563` | GPS ที่เช็คอิน |
| `lng` | number | `100.5018` | GPS ที่เช็คอิน |
| `distance_m` | number | `45` | ระยะห่างจากพิกัดร้าน (m) |
| `selfie_url` | string | Google Drive URL | selfie ของวันนั้น |
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
| `total_amount` | number | `5200` | full×400 + half×200 |
| `status` | enum | `รอจ่าย` / `จ่ายแล้ว` | |
| `closed_at` | datetime | | เวลาที่เจ้าของกด "ปิดยอด" |
| `paid_at` | datetime | nullable | เวลาที่เจ้าของกด "จ่ายแล้ว" |
| `note` | string | nullable | เช่น "ลาออก", "หักล่วงหน้า 500" |

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

---

## 5. Conventions

1. **ภาษา:** Comment ใน code = ไทย, ตัวแปร/function = อังกฤษ
2. **Error handling:** ทุก function ของ Apps Script ต้อง try-catch + log ลง Sheet `Logs`
3. **Idempotent:** เช็คอินซ้ำในวันเดียวกัน = ไม่สร้างแถวใหม่ (เช็ค `employee_id` + `checkin_date`)
4. **Timeout:** Apps Script function ต้องจบภายใน 6 นาที
5. **Secrets:** ใส่ใน Script Properties (`LINE_CHANNEL_ACCESS_TOKEN`, `OWNER_LINE_USER_ID`, `SHEET_ID`, `LIFF_ID`) ห้ามใส่ใน code
6. **Time zone:** ทุก datetime เก็บเป็น `Asia/Bangkok` (ISO 8601 พร้อม offset `+07:00`)
7. **ID format:**
   - Employees: `EMP-XXXX` (4 หลัก running)
   - Checkins: `CHK-YYYYMMDD-XXXX`
   - Payments: `PAY-YYYYMM-XXXX`
8. **Image storage:** อัพรูปลง Google Drive folder เดียวกับ Sheet → เก็บ URL ลง Sheet (ห้ามเก็บ base64 ในเซลล์)
9. **GPS check:** ใช้สูตร haversine คำนวณระยะ ถ้าเกิน `geofence_radius_m` → reject เช็คอิน
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
