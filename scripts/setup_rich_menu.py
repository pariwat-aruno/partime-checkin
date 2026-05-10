#!/usr/bin/env python3
"""
setup_rich_menu.py — สร้าง + อัปโหลด rich menu ของ partime-checkin (TASK-06)

วิธีใช้:
    export LINE_CHANNEL_ACCESS_TOKEN="..."   # token จาก TASK-04
    python3 scripts/setup_rich_menu.py

idempotent: ถ้าเจอ rich menu ชื่อ "partime-checkin-main" อยู่แล้วจะลบทิ้งก่อน
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

MENU_NAME = "partime-checkin-main"
IMAGE_PATH = os.path.join(os.path.dirname(__file__), "rich_menu.png")
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "liff", "img", "logo.jpg")

# ขนาดมาตรฐาน rich menu (LINE บังคับ 2500x843 หรือ 2500x1686)
WIDTH = 2500
HEIGHT = 843

# cherry red palette — บริษัท วอร์ด้า สกินแคร์ จำกัด
# 3 sections — ปุ่ม Owner ขวาสุด สีต่างเพื่อแยกชัด
SECTIONS = [
    {"label": "เช็คอิน",   "color": (200, 16,  46), "liff": LIFF_CHECKIN},
    {"label": "ดูยอด",     "color": (154, 12,  36), "liff": LIFF_BALANCE},
    {"label": "Owner",     "color": ( 55, 65,  81), "liff": LIFF_ADMIN},  # dark neutral
]
SECTION_W = WIDTH // len(SECTIONS)  # 3 sections ≈ 833 each
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


def load_thai_font(size: int):
    for p in THAI_FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_image():
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    label_font = load_thai_font(150)
    brand_font = load_thai_font(38)

    BRAND_BAND_H = 80  # แถบล่างใส่ brand
    main_h = HEIGHT - BRAND_BAND_H

    for i, sec in enumerate(SECTIONS):
        x0 = i * SECTION_W
        x1 = x0 + SECTION_W
        # พื้น (เฉพาะส่วน main)
        draw.rectangle([x0, 0, x1, main_h], fill=sec["color"])
        # ขีดแบ่งแบบ minimal
        if i > 0:
            draw.line([x0, 30, x0, main_h - 30], fill="white", width=3)

        # label center vertically ใน main area
        cx = x0 + SECTION_W // 2
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
        from PIL import ImageOps
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

    img.save(IMAGE_PATH, format="PNG")
    print(f"เขียนรูป {IMAGE_PATH} ({WIDTH}x{HEIGHT})")
    return IMAGE_PATH


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
        if menu.get("name") == MENU_NAME:
            mid = menu["richMenuId"]
            print(f"ลบ rich menu เดิม {mid}")
            request_json("DELETE", f"{API_BASE}/v2/bot/richmenu/{mid}", token)


def create_menu_structure(token):
    payload = {
        "size": {"width": WIDTH, "height": HEIGHT},
        "selected": True,
        "name": MENU_NAME,
        "chatBarText": "เมนู",
        "areas": [
            {
                "bounds": {"x": i * SECTION_W, "y": 0, "width": SECTION_W, "height": HEIGHT},
                "action": {
                    "type": "uri",
                    "label": sec["label"],
                    "uri": f"https://liff.line.me/{sec['liff']}",
                },
            }
            for i, sec in enumerate(SECTIONS)
        ],
    }
    res = request_json("POST", f"{API_BASE}/v2/bot/richmenu", token, body=payload)
    rid = res["richMenuId"]
    print(f"สร้าง rich menu structure id={rid}")
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
    print(f"ตั้ง {rid} เป็น default rich menu แล้ว")


def main():
    token = get_token()
    img_path = make_image()
    cleanup_old(token)
    rid = create_menu_structure(token)
    upload_image(token, rid, img_path)
    set_default(token, rid)
    print("=========================================")
    print(f"DONE — rich menu id = {rid}")
    print("เปิด LINE → add bot เป็นเพื่อน → จะเห็น rich menu 3 ปุ่ม")


if __name__ == "__main__":
    main()
