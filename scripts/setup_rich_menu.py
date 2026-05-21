#!/usr/bin/env python3
"""
setup_rich_menu.py — สร้าง + อัปโหลด rich menu ของ partime-checkin (TASK-06)

สร้าง 2 เมนู:
  - staff  : ปุ่มเดียว "เช็คอิน" — ตั้งเป็น default rich menu ให้ทุกคน
  - owner  : 2 ปุ่ม "เช็คอิน | Owner" — link เฉพาะ LINE userId ของเจ้าของ
             (พนักงานทั่วไปจะไม่เห็นปุ่ม Owner)

วิธีใช้:
    export LINE_CHANNEL_ACCESS_TOKEN="..."   # token จาก TASK-04
    export OWNER_LINE_USER_ID="U..."         # userId เจ้าของ (เหมือนใน Script Properties)
    python3 scripts/setup_rich_menu.py

idempotent: ถ้าเจอ rich menu ชื่อเดิม (staff/owner/main) อยู่แล้วจะลบทิ้งก่อน
"""

import json
import os
import sys
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

# ----- CONFIG (sync กับ project_partime_checkin.md) -----
LIFF_REGISTER = "2010027935-yGV4yPSO"
LIFF_CHECKIN = "2010027935-VNfQm4KC"
LIFF_BALANCE = "2010027935-GqOSphZC"
LIFF_ADMIN   = "2010027935-J0G7Diq4"

STAFF_MENU_NAME = "partime-checkin-staff"
OWNER_MENU_NAME = "partime-checkin-owner"
# ชื่อเมนูเก่า ๆ ที่ต้องลบทิ้งตอน cleanup (รวม legacy "main")
OBSOLETE_MENU_NAMES = {STAFF_MENU_NAME, OWNER_MENU_NAME, "partime-checkin-main"}

LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "liff", "img", "logo.jpg")

# ขนาดมาตรฐาน rich menu (LINE บังคับ 2500x843 หรือ 2500x1686)
WIDTH = 2500
HEIGHT = 843

# cherry red palette — บริษัท วอร์ด้า สกินแคร์ จำกัด
CHECKIN_SEC = {"label": "เช็คอิน", "color": (200, 16, 46), "liff": LIFF_CHECKIN}
OWNER_SEC   = {"label": "Owner",   "color": ( 55, 65, 81), "liff": LIFF_ADMIN}  # dark neutral

# พนักงาน = checkin ปุ่มเดียว / เจ้าของ = checkin + Owner
STAFF_SECTIONS = [CHECKIN_SEC]
OWNER_SECTIONS = [CHECKIN_SEC, OWNER_SEC]

BRAND_TEXT = "บริษัท วอร์ด้า สกินแคร์ จำกัด"

THAI_FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/SukhumvitSet.ttc",
    "/System/Library/Fonts/ThonburiUI.ttc",
    "/System/Library/Fonts/Supplemental/Thonburi.ttc",
]

API_BASE = "https://api.line.me"
API_DATA = "https://api-data.line.me"


def get_token():
    tok = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    if not tok:
        sys.exit("[error] ตั้ง env LINE_CHANNEL_ACCESS_TOKEN ก่อน")
    return tok


def get_owner_user_id():
    uid = os.environ.get("OWNER_LINE_USER_ID")
    if not uid:
        sys.exit("[error] ตั้ง env OWNER_LINE_USER_ID ก่อน (userId เจ้าของ ขึ้นต้นด้วย U)")
    return uid


def load_thai_font(size: int):
    for p in THAI_FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_image(sections, out_path):
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    label_font = load_thai_font(150)
    brand_font = load_thai_font(38)

    section_w = WIDTH // len(sections)
    BRAND_BAND_H = 80  # แถบล่างใส่ brand
    main_h = HEIGHT - BRAND_BAND_H

    for i, sec in enumerate(sections):
        x0 = i * section_w
        x1 = x0 + section_w
        # พื้น (เฉพาะส่วน main)
        draw.rectangle([x0, 0, x1, main_h], fill=sec["color"])
        # ขีดแบ่งแบบ minimal
        if i > 0:
            draw.line([x0, 30, x0, main_h - 30], fill="white", width=3)

        # label center vertically ใน main area
        cx = x0 + section_w // 2
        bbox = draw.textbbox((0, 0), sec["label"], font=label_font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        ty = (main_h - text_h) // 2 - 10
        draw.text((cx - text_w // 2, ty), sec["label"], font=label_font, fill="white")

    # แถบ brand ด้านล่าง — สีอ่อน + logo + brand text
    draw.rectangle([0, main_h, WIDTH, HEIGHT], fill=(249, 250, 251))  # near-white
    draw.line([0, main_h, WIDTH, main_h], fill=(229, 231, 235), width=2)

    bbox = draw.textbbox((0, 0), BRAND_TEXT, font=brand_font)
    bw = bbox[2] - bbox[0]
    bh = bbox[3] - bbox[1]
    band_cy = main_h + BRAND_BAND_H // 2

    # logo (round-cropped) ด้านซ้ายของ text
    try:
        logo_size = 56
        logo = Image.open(LOGO_PATH).convert("RGB").resize((logo_size, logo_size))
        # mask วงกลม
        mask = Image.new("L", (logo_size, logo_size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, logo_size, logo_size], fill=255)
        # composite
        logo_x = (WIDTH - bw - logo_size - 14) // 2
        logo_y = band_cy - logo_size // 2
        img.paste(logo, (logo_x, logo_y), mask)
        text_x = logo_x + logo_size + 14
    except Exception as e:
        print(f"[warn] logo paste failed: {e}")
        text_x = (WIDTH - bw) // 2

    text_y = band_cy - bh // 2 - 8
    draw.text((text_x, text_y), BRAND_TEXT, font=brand_font, fill=(154, 12, 36))

    img.save(out_path, format="PNG")
    print(f"เขียนรูป {out_path} ({WIDTH}x{HEIGHT}, {len(sections)} ปุ่ม)")
    return out_path


def request_json(method, url, token, body=None):
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"[error] {method} {url} -> {e.code} {e.read().decode('utf-8', 'ignore')}")


def cleanup_old(token):
    res = request_json("GET", f"{API_BASE}/v2/bot/richmenu/list", token)
    for menu in res.get("richmenus", []):
        if menu.get("name") in OBSOLETE_MENU_NAMES:
            mid = menu["richMenuId"]
            print(f"ลบ rich menu เดิม {menu.get('name')} ({mid})")
            request_json("DELETE", f"{API_BASE}/v2/bot/richmenu/{mid}", token)


def create_menu_structure(token, sections, name):
    section_w = WIDTH // len(sections)
    payload = {
        "size": {"width": WIDTH, "height": HEIGHT},
        "selected": True,
        "name": name,
        "chatBarText": "เมนู",
        "areas": [
            {
                "bounds": {"x": i * section_w, "y": 0, "width": section_w, "height": HEIGHT},
                "action": {
                    "type": "uri",
                    "label": sec["label"],
                    "uri": f"https://liff.line.me/{sec['liff']}",
                },
            }
            for i, sec in enumerate(sections)
        ],
    }
    res = request_json("POST", f"{API_BASE}/v2/bot/richmenu", token, body=payload)
    rid = res["richMenuId"]
    print(f"สร้าง rich menu '{name}' id={rid}")
    return rid


def upload_image(token, rid, path):
    with open(path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"{API_DATA}/v2/bot/richmenu/{rid}/content",
        data=data,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "image/png"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"อัปรูปสำเร็จ ({len(data)} bytes)")
    except urllib.error.HTTPError as e:
        sys.exit(f"[error] upload image -> {e.code} {e.read().decode('utf-8', 'ignore')}")


def set_default(token, rid):
    request_json("POST", f"{API_BASE}/v2/bot/user/all/richmenu/{rid}", token)
    print(f"ตั้ง {rid} เป็น default rich menu (ทุกคน)")


def link_user(token, user_id, rid):
    request_json("POST", f"{API_BASE}/v2/bot/user/{user_id}/richmenu/{rid}", token)
    print(f"link เมนู owner {rid} ให้ userId {user_id}")


def main():
    token = get_token()
    owner_uid = get_owner_user_id()

    here = os.path.dirname(__file__)
    staff_img = make_image(STAFF_SECTIONS, os.path.join(here, "rich_menu_staff.png"))
    owner_img = make_image(OWNER_SECTIONS, os.path.join(here, "rich_menu_owner.png"))

    cleanup_old(token)

    # staff = default (ทุกคนเห็น checkin ปุ่มเดียว)
    staff_rid = create_menu_structure(token, STAFF_SECTIONS, STAFF_MENU_NAME)
    upload_image(token, staff_rid, staff_img)
    set_default(token, staff_rid)

    # owner = link เฉพาะ userId เจ้าของ (override default ของคนนั้น)
    owner_rid = create_menu_structure(token, OWNER_SECTIONS, OWNER_MENU_NAME)
    upload_image(token, owner_rid, owner_img)
    link_user(token, owner_uid, owner_rid)

    print("=========================================")
    print(f"DONE — staff menu = {staff_rid}")
    print(f"       owner menu = {owner_rid} (userId {owner_uid})")
    print("พนักงานทั่วไป: เห็นปุ่ม 'เช็คอิน' อย่างเดียว")
    print("เจ้าของ: เห็น 'เช็คอิน | Owner'")


if __name__ == "__main__":
    main()
