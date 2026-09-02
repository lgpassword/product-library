# -*- coding: utf-8 -*-
"""
生成开源演示数据库(data.db)与示例产品占位图。

所有产品 / 厂商 / 价格 / 图片均为虚构示例，仅用于演示产品库功能，
不包含任何真实商业数据（渠道价、厂家联系方式等）。

用法（在仓库根目录执行）：
    python sample_data/generate_demo_data.py

重复执行不会覆盖已存在的 data.db（如需重建请先删除 data.db）。
"""
import os
import uuid
import sqlite3
from datetime import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE, "data.db")
IMAGE_DIR = os.path.join(BASE, "uploads", "images")

# ---------------- 虚构数据 ----------------
CATEGORIES = [
    "认知训练", "感官互动", "音乐治疗", "运动康复",
    "言语训练", "心理辅导", "教学辅助",
]

COMPANIES = [
    "示例医疗科技有限公司",
    "示例教育装备有限公司",
    "示例康复设备有限公司",
]

TAGS = ["新品", "热门", "便携式", "国产", "招投标常用", "定制化"]

# (名称, 型号, 分类, 厂商, 市场价, 渠道价, 标签列表)
PRODUCTS = [
    ("智能认知能力评估训练系统", "DEMO-KZ-01", "认知训练", "示例医疗科技有限公司", 158000, 110600, ["新品", "招投标常用"]),
    ("多感官互动训练仪（声光触一体）", "DEMO-GG-02", "感官互动", "示例教育装备有限公司", 86000, 60200, ["热门"]),
    ("音乐治疗互动反馈系统", "DEMO-YY-03", "音乐治疗", "示例康复设备有限公司", 129000, 90300, ["热门", "定制化"]),
    ("儿童运动康复评估训练台", "DEMO-YD-04", "运动康复", "示例医疗科技有限公司", 98000, 68600, ["招投标常用"]),
    ("言语构音评估与训练软件", "DEMO-YL-05", "言语训练", "示例教育装备有限公司", 45000, 31500, ["新品", "便携式"]),
    ("专注力脑电反馈训练系统", "DEMO-ZZ-06", "认知训练", "示例康复设备有限公司", 76000, 53200, ["新品"]),
    ("律动教室智能控制系统", "DEMO-LD-07", "音乐治疗", "示例教育装备有限公司", 66000, 46200, ["热门"]),
    ("AR 互动数字仿生训练系统", "DEMO-AR-08", "感官互动", "示例医疗科技有限公司", 198000, 138600, ["新品", "定制化"]),
    ("情绪与行为干预辅助终端", "DEMO-QX-09", "心理辅导", "示例教育装备有限公司", 56000, 39200, ["新品", "便携式"]),
    ("感觉统合训练组合套装", "DEMO-GT-10", "运动康复", "示例康复设备有限公司", 88000, 61600, ["热门", "招投标常用"]),
    ("便携式手功能康复训练器", "DEMO-SK-11", "运动康复", "示例医疗科技有限公司", 32000, 22400, ["便携式"]),
    ("可视音乐宣泄系统", "DEMO-XS-12", "心理辅导", "示例康复设备有限公司", 72000, 50400, ["定制化"]),
    ("结构化教学视觉提示套装", "DEMO-JG-13", "教学辅助", "示例教育装备有限公司", 15000, 10500, ["新品", "热门"]),
    ("轮椅适配体适能评估系统", "DEMO-LY-14", "运动康复", "示例医疗科技有限公司", 139000, 97300, ["招投标常用"]),
    ("数字化心理咨询与放松系统", "DEMO-XL-15", "心理辅导", "示例康复设备有限公司", 68000, 47600, ["热门"]),
    ("口肌与呼吸训练套装", "DEMO-KQ-16", "言语训练", "示例教育装备有限公司", 12000, 8400, ["便携式"]),
]

# ---------------- 占位图 ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

PALETTE = [
    (84, 160, 255), (46, 194, 126), (255, 170, 60),
    (160, 120, 255), (255, 110, 140), (64, 190, 220),
    (120, 200, 90), (240, 150, 80),
]


def _font(size):
    from PIL import ImageFont
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_placeholder(path, text, idx):
    from PIL import Image, ImageDraw
    W, H = 640, 480
    base = PALETTE[idx % len(PALETTE)]
    img = Image.new("RGB", (W, H), base)
    d = ImageDraw.Draw(img)
    # 简单渐变叠加
    for y in range(H):
        f = y / H
        c = tuple(int(base[i] * (1 - f * 0.35)) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    d.rectangle([0, 0, W - 1, H - 1], outline=(255, 255, 255), width=6)
    f_big = _font(42)
    f_small = _font(26)
    tw = d.textlength(text, font=f_big)
    d.text(((W - tw) / 2, H / 2 - 60), text, fill=(255, 255, 255), font=f_big)
    tip = "示例占位图 · 演示数据"
    tw2 = d.textlength(tip, font=f_small)
    d.text(((W - tw2) / 2, H / 2 + 20), tip, fill=(255, 255, 255), font=f_small)
    img.save(path, "PNG")


def main():
    if os.path.exists(DB_PATH):
        print(f"已存在 {DB_PATH}，跳过（如需重建请先删除该文件）")
        return
    os.makedirs(IMAGE_DIR, exist_ok=True)

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1) 生成占位图并记录
    image_rows = []  # (product_idx, filename, stored_name)
    for i, (name, *_rest) in enumerate(PRODUCTS, start=1):
        stored = uuid.uuid4().hex + ".png"
        make_placeholder(os.path.join(IMAGE_DIR, stored), f"DEMO-{i:02d}", i - 1)
        image_rows.append((i, f"{name}.png", stored))

    # 2) 建库（结构对齐 database.py）
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript("""
    CREATE TABLE category (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE company (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE tag (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE product (id INTEGER PRIMARY KEY AUTOINCREMENT, seq TEXT, name TEXT NOT NULL,
        intro TEXT, params TEXT, model TEXT, market_price REAL, channel_price REAL,
        category_id INTEGER, company_id INTEGER, contact_phone TEXT, contact_person TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE product_tag (product_id INTEGER NOT NULL, tag_id INTEGER NOT NULL,
        PRIMARY KEY (product_id, tag_id));
    CREATE TABLE attachment (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
        filename TEXT NOT NULL, stored_name TEXT NOT NULL, kind TEXT NOT NULL,
        size INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE file (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL,
        stored_name TEXT NOT NULL, folder TEXT DEFAULT '', size INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE folder (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS idx_product_category ON product(category_id);
    CREATE INDEX IF NOT EXISTS idx_product_company ON product(company_id);
    CREATE INDEX IF NOT EXISTS idx_product_name ON product(name);
    CREATE INDEX IF NOT EXISTS idx_attachment_product ON attachment(product_id);
    """)

    cat_ids = {n: cur.execute("INSERT INTO category(name) VALUES(?)", (n,)).lastrowid
               for n in CATEGORIES}
    com_ids = {n: cur.execute("INSERT INTO company(name) VALUES(?)", (n,)).lastrowid
               for n in COMPANIES}
    tag_ids = {n: cur.execute("INSERT INTO tag(name) VALUES(?)", (n,)).lastrowid
               for n in TAGS}

    for seq, (name, model, cat, company, mp, cp, tags) in enumerate(PRODUCTS, start=1):
        intro = f"{name}（演示数据）：面向特殊教育 / 康复场景的多功能训练设备，支持个性化方案配置与数据留档。"
        params = "供电：AC 220V / 50Hz；屏幕：21.5 英寸触摸；接口：USB×2、RJ45×1、蓝牙；尺寸约 120×70×160cm；净重约 85kg。"
        pid = cur.execute(
            """INSERT INTO product(seq,name,intro,params,model,market_price,channel_price,
               category_id,company_id,contact_phone,contact_person,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (seq, name, intro, params, model, mp, cp,
             cat_ids[cat], com_ids[company], "", "", now, now),
        ).lastrowid
        for t in tags:
            cur.execute("INSERT OR IGNORE INTO product_tag(product_id, tag_id) VALUES(?,?)",
                        (pid, tag_ids[t]))

    # 3) 附件记录（图片关联）
    for prod_seq, filename, stored in image_rows:
        fpath = os.path.join(IMAGE_DIR, stored)
        size = os.path.getsize(fpath)
        cur.execute(
            "INSERT INTO attachment(product_id, filename, stored_name, kind, size) "
            "VALUES(?,?,?,?,?)",
            (prod_seq, filename, stored, "image", size),
        )

    conn.commit()
    conn.close()
    print(f"完成：已生成 {DB_PATH}")
    print(f"分类 {len(CATEGORIES)} 个 / 厂商 {len(COMPANIES)} 个 / 标签 {len(TAGS)} 个 / "
          f"产品 {len(PRODUCTS)} 条 / 示例图 {len(image_rows)} 张")


if __name__ == "__main__":
    main()
