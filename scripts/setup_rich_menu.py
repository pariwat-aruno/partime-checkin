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

MENU_NAME = "partime-checkin-main"
IMAGE_PATH = os.path.join(os.path.dirname(__file__), "rich_menu.png")

# ขนาดมาตรฐาน rich menu (LINE บังคับ 2500x843 หรือ 2500x1686)
WIDTH = 2500
HEIGHT = 843
SECTION_W = WIDTH // 3  # 833

# สี + label ของแต่ละช่อง
SECTIONS = [
    {"label": "ลงทะเบียน", "icon": "📝", "color": (6, 199, 85), "liff": LIFF_REGISTER},
    {"label": "เช็คอิน",   "icon": "📍", "color": (66, 133, 244), "liff": LIFF_CHECKIN},
    {"label": "ดูยอด",     "icon": "💰", "color": (251, 188, 4),  "liff": LIFF_BALANCE},
]

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
        sys.exit("❌ ตั้ง env LINE_CHANNEL_ACCESS_TOKEN ก่อน")
    return tok


def load_thai_font(size: int):
    for p in THAI_FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_image():
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    label_font = load_thai_font(140)
    icon_font = load_thai_font(200)

    for i, sec in enumerate(SECTIONS):
        x0 = i * SECTION_W
        x1 = x0 + SECTION_W
        # พื้น
        draw.rectangle([x0, 0, x1, HEIGHT], fill=sec["color"])
        # ขีดแบ่ง
        if i > 0:
            draw.line([x0, 0, x0, HEIGHT], fill="white", width=4)

        # icon (emoji อาจ render ไม่ครบใน PIL — fallback แค่ label ก็พอ)
        cx = x0 + SECTION_W // 2

        # label
        bbox = draw.textbbox((0, 0), sec["label"], font=label_font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        ty = HEIGHT // 2 - text_h // 2
        draw.text((cx - text_w // 2, ty), sec["label"], font=label_font, fill="white")

    img.save(IMAGE_PATH, format="PNG")
    print(f"✅ เขียนรูป {IMAGE_PATH} ({WIDTH}x{HEIGHT})")
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
        sys.exit(f"❌ {method} {url} → {e.code} {e.read().decode('utf-8', 'ignore')}")


def cleanup_old(token):
    res = request_json("GET", f"{API_BASE}/v2/bot/richmenu/list", token)
    for menu in res.get("richmenus", []):
        if menu.get("name") == MENU_NAME:
            mid = menu["richMenuId"]
            print(f"🧹 ลบ rich menu เดิม {mid}")
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
    print(f"✅ สร้าง rich menu structure id={rid}")
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
            print(f"✅ อัปรูปสำเร็จ ({len(data)} bytes)")
    except urllib.error.HTTPError as e:
        sys.exit(f"❌ upload image → {e.code} {e.read().decode('utf-8', 'ignore')}")


def set_default(token, rid):
    request_json("POST", f"{API_BASE}/v2/bot/user/all/richmenu/{rid}", token)
    print(f"✅ ตั้ง {rid} เป็น default rich menu แล้ว")


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
