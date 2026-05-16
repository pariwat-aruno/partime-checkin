# partime-checkin

ระบบลงทะเบียน + เช็คอินพาร์ทไทม์ผ่าน LINE
พาร์ทไทม์ลงทะเบียนเอง → เช็คอินรายวันด้วย GPS + selfie → เจ้าของอนุมัติผ่าน flex card → ระบบคำนวณค่าจ้างให้

## Stack

- Google Sheets (ฐานข้อมูล)
- Google Apps Script (backend)
- Google Drive (เก็บรูป)
- LINE Messaging API + LIFF (UI พาร์ทไทม์ + flex card เจ้าของ)
- (optional) n8n สำหรับ retry queue

## เริ่มยังไง

อ่าน 3 ไฟล์ตามลำดับ:

1. **[CONTEXT.md](CONTEXT.md)** — ศัพท์เฉพาะ + data model + roles + ห้ามทำอะไร
2. **[docs/architecture.md](docs/architecture.md)** — diagram + data flow + setup plan
3. **[TASKS.md](TASKS.md)** — TODO ย่อย 29 task พร้อม acceptance criteria

## สำหรับ Claude Code

ใช้คำสั่งนี้ตอนเริ่ม:

```
อ่าน CONTEXT.md, docs/architecture.md, TASKS.md
แล้วเริ่มจาก TASK-01 — ทำทีละ task ตามลำดับ
ห้ามข้าม dependency
```

## Workflow ทีม

- เจอเรื่องที่ architecture ไม่ครอบคลุม → แก้ `docs/architecture.md` ก่อน อย่าแก้ใน code อย่างเดียว
- เจอคำใหม่/ตัด field → แก้ `CONTEXT.md` ก่อน
- เพิ่ม/แก้ task → แก้ `TASKS.md` ก่อนเริ่ม implement

## Status

- [ ] Phase 1 — Setup ฐานข้อมูล (TASK-01 ถึง TASK-03)
- [ ] Phase 2 — LINE setup (TASK-04 ถึง TASK-06)
- [ ] Phase 3 — Apps Script foundation (TASK-07 ถึง TASK-13)
- [ ] Phase 4 — Apps Script endpoints (TASK-14 ถึง TASK-20)
- [ ] Phase 5 — LIFF frontend (TASK-21 ถึง TASK-24)
- [ ] Phase 6 — Deploy + test (TASK-25 ถึง TASK-29)

## Flow ล่าสุดของ Owner

- พาร์ทไทม์เช็คอิน 4 slot ต่อวัน
- เจ้าของอนุมัติ `เต็มวัน` / `ครึ่งวัน` / `ไม่อนุมัติ`
- หน้า Owner ใช้ปิดยอดรายคนต่อรอบจ่าย
- ตอนปิดยอดใส่ `เงินพิเศษ`, `เงิน OT`, และหมายเหตุได้
- ระบบกันปิดยอดซ้ำต่อ `พาร์ทไทม์ + รอบจ่าย`
- ปิดยอดแล้วระบบแจ้งพาร์ทไทม์ว่าสถานะ `รอจ่าย`
- กด `ทำเครื่องหมายจ่ายแล้ว` แล้วระบบแจ้งพาร์ทไทม์ว่าสถานะ `จ่ายแล้ว`
- ถ้ากดผิด เจ้าของกด `แก้เป็นรอจ่าย` พร้อมเหตุผลได้
- ปุ่ม `ประวัติ` ในหน้า Owner แสดงเช็คอินและรอบจ่ายรายคน

คอลัมน์ payment ปัจจุบันรองรับ:

`base_amount`, `extra_amount`, `ot_amount`, `total_amount`, `adjustment_note`

## Deploy note

- ฝั่ง LIFF ใช้ `API_URL` จาก `liff/js/config.js`
- ฝั่ง Apps Script ต้อง deploy เป็น Web App แบบ public anonymous ไม่งั้นหน้า Owner จะขึ้น `Load failed`
- ถ้าเปลี่ยน deployment ของ Apps Script แล้ว ให้เปลี่ยน `API_URL` ให้ตรง deployment ล่าสุดทุกครั้ง
- ถ้าเปิดหน้า Owner แล้วกด `ประวัติ` ได้ `unknown_action` มักแปลว่า frontend หรือ Web App ยังเป็นเวอร์ชันเก่า ให้รีโหลดหน้า LIFF แล้วตรวจ deployment อีกครั้ง
- หน้าเช็คอินตอนนี้ใช้ปุ่ม `เปิดกล้อง` ก่อนเริ่ม permission camera
- ถ้า owner กด `รับทราบ` รายการนอกเขต ระบบจะเก็บสถานะไว้ใน `OwnerLogs` และแสดง `รับทราบแล้ว` ในประวัติ

## Troubleshooting สั้น ๆ

- `Load failed` = ตรวจ `API_URL` และสิทธิ์ Web App ก่อน
- `unknown_action` = ตรวจว่า frontend เรียก backend รุ่นล่าสุด
- หน้า Owner ว่างเปล่า = ตรวจว่า LIFF init ผ่าน และ `idToken` ถูกส่งไปกับ request
