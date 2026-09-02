import os
import io
import re
import uuid
import zipfile
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from urllib.parse import quote
from pydantic import BaseModel
from typing import Optional, List

import openpyxl
from openpyxl.styles import Font
from openpyxl.drawing.image import Image as XLImage

from database import get_conn, init_db, BASE_DIR, IMAGE_DIR, FILE_DIR, LIBRARY_DIR, DB_PATH

init_db()

app = FastAPI(title="产品库系统")


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def row_to_dict(row):
    return dict(row) if row is not None else None


def get_product_tags(conn, product_id):
    rows = conn.execute(
        "SELECT t.id, t.name FROM tag t JOIN product_tag pt ON t.id=pt.tag_id "
        "WHERE pt.product_id=? ORDER BY t.name", (product_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def product_full(conn, p):
    if p is None:
        return None
    d = dict(p)
    d["tags"] = get_product_tags(conn, d["id"])
    atts = conn.execute(
        "SELECT id, filename, kind, size, created_at FROM attachment "
        "WHERE product_id=? ORDER BY id", (d["id"],)
    ).fetchall()
    d["attachments"] = [dict(a) for a in atts]
    return d


# ---------- 字典 ----------

def list_dict(conn, table):
    return [dict(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()]


@app.get("/api/categories")
def get_categories():
    conn = get_conn()
    data = list_dict(conn, "category")
    conn.close()
    return data


@app.post("/api/categories")
def add_category(payload: dict):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "名称不能为空")
    conn = get_conn()
    try:
        cur = conn.execute("INSERT INTO category(name) VALUES(?)", (name,))
        conn.commit()
        return {"id": cur.lastrowid, "name": name}
    except Exception as e:
        raise HTTPException(400, "已存在或参数错误")
    finally:
        conn.close()


@app.delete("/api/categories/{cid}")
def del_category(cid: int):
    conn = get_conn()
    conn.execute("DELETE FROM category WHERE id=?", (cid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/companies")
def get_companies():
    conn = get_conn()
    data = list_dict(conn, "company")
    conn.close()
    return data


@app.post("/api/companies")
def add_company(payload: dict):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "名称不能为空")
    conn = get_conn()
    try:
        cur = conn.execute("INSERT INTO company(name) VALUES(?)", (name,))
        conn.commit()
        return {"id": cur.lastrowid, "name": name}
    except Exception:
        raise HTTPException(400, "已存在或参数错误")
    finally:
        conn.close()


@app.delete("/api/companies/{cid}")
def del_company(cid: int):
    conn = get_conn()
    conn.execute("DELETE FROM company WHERE id=?", (cid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/tags")
def get_tags():
    conn = get_conn()
    data = list_dict(conn, "tag")
    conn.close()
    return data


@app.post("/api/tags")
def add_tag(payload: dict):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "名称不能为空")
    conn = get_conn()
    try:
        cur = conn.execute("INSERT INTO tag(name) VALUES(?)", (name,))
        conn.commit()
        return {"id": cur.lastrowid, "name": name}
    except Exception:
        raise HTTPException(400, "已存在或参数错误")
    finally:
        conn.close()


@app.delete("/api/tags/{tid}")
def del_tag(tid: int):
    conn = get_conn()
    conn.execute("DELETE FROM tag WHERE id=?", (tid,))
    conn.execute("DELETE FROM product_tag WHERE tag_id=?", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- 产品 ----------

@app.get("/api/products")
def list_products(
    search: str = "",
    category_id: Optional[int] = None,
    company_id: Optional[int] = None,
    tag_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
    price_field: str = "channel",        # market=市场价 channel=渠道价(进货价)
    price_min: Optional[float] = None,   # 金额区间下限
    price_max: Optional[float] = None,   # 金额区间上限
    sort: str = "",                      # ""=按序号 price_asc/price_desc=按所选价格
):
    conn = get_conn()
    where = []
    args = []
    if search:
        like = f"%{search}%"
        where.append("(p.name LIKE ? OR p.model LIKE ? OR p.intro LIKE ? OR p.params LIKE ? OR p.seq LIKE ?)")
        args += [like, like, like, like, like]
    if category_id:
        where.append("p.category_id=?")
        args.append(category_id)
    if company_id:
        where.append("p.company_id=?")
        args.append(company_id)
    if tag_id:
        where.append("p.id IN (SELECT product_id FROM product_tag WHERE tag_id=?)")
        args.append(tag_id)
    # 金额区间筛选（按所选价格字段）
    pf = "market_price" if price_field == "market" else "channel_price"
    if price_min is not None:
        where.append(f"IFNULL(p.{pf}, -1) >= ?")
        args.append(price_min)
    if price_max is not None:
        where.append(f"IFNULL(p.{pf}, -1) <= ?")
        args.append(price_max)
    # 排序
    if sort in ("price_asc", "price_desc"):
        d = "ASC" if sort == "price_asc" else "DESC"
        order = f"ORDER BY CASE WHEN p.{pf} IS NULL THEN 1 ELSE 0 END, p.{pf} {d}, p.id ASC"
    else:
        order = "ORDER BY CAST(p.seq AS INTEGER) ASC, p.id ASC"

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(
        f"SELECT COUNT(*) FROM product p {where_sql}", args
    ).fetchone()[0]

    sql = f"""
        SELECT p.*, c.name AS category_name, co.name AS company_name
        FROM product p
        LEFT JOIN category c ON p.category_id=c.id
        LEFT JOIN company co ON p.company_id=co.id
        {where_sql}
        {order}
        LIMIT ? OFFSET ?
    """
    rows = conn.execute(sql, args + [page_size, (page - 1) * page_size]).fetchall()
    # 批量取标签和附件（避免 N+1 查询）
    ids = [r["id"] for r in rows]
    tags_map = {}
    atts_map = {}
    if ids:
        ph = ",".join("?" for _ in ids)
        for row in conn.execute(
            f"""SELECT pt.product_id, t.id, t.name FROM product_tag pt
                JOIN tag t ON t.id=pt.tag_id WHERE pt.product_id IN ({ph}) ORDER BY t.name""",
            ids,
        ):
            tags_map.setdefault(row["product_id"], []).append({"id": row["id"], "name": row["name"]})
        for row in conn.execute(
            f"""SELECT id, product_id, filename, kind FROM attachment
                WHERE product_id IN ({ph}) ORDER BY id""",
            ids,
        ):
            kind = "images" if row["kind"] == "image" else "files"
            atts_map.setdefault((row["product_id"], kind), []).append(
                {"id": row["id"], "filename": row["filename"]}
            )
    items = []
    for r in rows:
        d = dict(r)
        d["tags"] = tags_map.get(d["id"], [])
        d["images"] = atts_map.get((d["id"], "images"), [])
        d["files"] = atts_map.get((d["id"], "files"), [])
        items.append(d)
    conn.close()
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@app.get("/api/products/{pid}")
def get_product(pid: int):
    conn = get_conn()
    p = conn.execute(
        "SELECT p.*, c.name AS category_name, co.name AS company_name "
        "FROM product p LEFT JOIN category c ON p.category_id=c.id "
        "LEFT JOIN company co ON p.company_id=co.id WHERE p.id=?", (pid,)
    ).fetchone()
    result = product_full(conn, p)
    conn.close()
    if result is None:
        raise HTTPException(404, "产品不存在")
    return result


class ProductIn(BaseModel):
    seq: Optional[str] = ""
    name: str
    intro: Optional[str] = ""
    params: Optional[str] = ""
    model: Optional[str] = ""
    market_price: Optional[float] = None
    channel_price: Optional[float] = None
    category_name: Optional[str] = ""
    company_name: Optional[str] = ""
    contact_phone: Optional[str] = ""
    contact_person: Optional[str] = ""
    tag_ids: Optional[List[int]] = []


def save_product_tags(conn, product_id, tag_ids):
    conn.execute("DELETE FROM product_tag WHERE product_id=?", (product_id,))
    for t in (tag_ids or []):
        conn.execute("INSERT OR IGNORE INTO product_tag(product_id, tag_id) VALUES(?,?)",
                     (product_id, t))


@app.post("/api/products")
def create_product(p: ProductIn):
    conn = get_conn()
    name = (p.name or "").strip()
    company_name = (p.company_name or "").strip()
    model = (p.model or "").strip()
    # 重复校验：名称 + 公司 + 型号都相同则提示
    dup = conn.execute(
        """SELECT p.id FROM product p JOIN company c ON p.company_id=c.id
           WHERE p.name=? AND c.name=? AND IFNULL(p.model,'')=?""",
        (name, company_name, model),
    ).fetchone()
    if dup:
        conn.close()
        raise HTTPException(409, f"已存在相同产品（名称、公司、型号均相同）：「{name}」-「{company_name}」-「{model or '无型号'}」")
    category_id = get_or_create(conn, "category", p.category_name)
    company_id = get_or_create(conn, "company", p.company_name)
    # 自动生成序号：按录入顺序，全局唯一（取当前最大序号 +1）
    row = conn.execute(
        "SELECT MAX(CAST(seq AS INTEGER)) AS m FROM product WHERE seq GLOB '[0-9]*'"
    ).fetchone()
    seq = str((row["m"] or 0) + 1)
    cur = conn.execute(
        """INSERT INTO product(seq,name,intro,params,model,market_price,channel_price,
           category_id,company_id,contact_phone,contact_person,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (seq, name, p.intro, p.params, model, p.market_price, p.channel_price,
         category_id, company_id, p.contact_phone, p.contact_person, now()),
    )
    pid = cur.lastrowid
    save_product_tags(conn, pid, p.tag_ids)
    conn.commit()
    conn.close()
    return {"id": pid, "seq": seq}


@app.put("/api/products/{pid}")
def update_product(pid: int, p: ProductIn):
    conn = get_conn()
    name = (p.name or "").strip()
    company_name = (p.company_name or "").strip()
    model = (p.model or "").strip()
    # 重复校验（排除自身）
    dup = conn.execute(
        """SELECT p.id FROM product p JOIN company c ON p.company_id=c.id
           WHERE p.name=? AND c.name=? AND IFNULL(p.model,'')=? AND p.id != ?""",
        (name, company_name, model, pid),
    ).fetchone()
    if dup:
        conn.close()
        raise HTTPException(409, f"已存在相同产品（名称、公司、型号均相同）：「{name}」-「{company_name}」-「{model or '无型号'}」")
    category_id = get_or_create(conn, "category", p.category_name)
    company_id = get_or_create(conn, "company", p.company_name)
    # 编辑不改变序号（序号按录入顺序自动生成）
    conn.execute(
        """UPDATE product SET name=?,intro=?,params=?,model=?,market_price=?,
           channel_price=?,category_id=?,company_id=?,contact_phone=?,contact_person=?,updated_at=?
           WHERE id=?""",
        (name, p.intro, p.params, model, p.market_price, p.channel_price,
         category_id, company_id, p.contact_phone, p.contact_person, now(), pid),
    )
    save_product_tags(conn, pid, p.tag_ids)
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/products/{pid}")
def delete_product(pid: int):
    conn = get_conn()
    for a in conn.execute("SELECT stored_name, kind FROM attachment WHERE product_id=?", (pid,)).fetchall():
        path = os.path.join(IMAGE_DIR if a["kind"] == "image" else FILE_DIR, a["stored_name"])
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
    conn.execute("DELETE FROM attachment WHERE product_id=?", (pid,))
    conn.execute("DELETE FROM product_tag WHERE product_id=?", (pid,))
    conn.execute("DELETE FROM product WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- 附件 ----------

@app.post("/api/products/{pid}/attachments")
async def upload_attachments(pid: int, files: List[UploadFile] = File(...), kind: str = "auto"):
    conn = get_conn()
    if not conn.execute("SELECT id FROM product WHERE id=?", (pid,)).fetchone():
        conn.close()
        raise HTTPException(404, "产品不存在")
    saved = []
    for f in files:
        ext = os.path.splitext(f.filename or "")[1]
        stored = uuid.uuid4().hex + ext
        ctype = (f.content_type or "").lower()
        fkind = kind if kind in ("image", "file") else ("image" if ctype.startswith("image/") else "file")
        target_dir = IMAGE_DIR if fkind == "image" else FILE_DIR
        path = os.path.join(target_dir, stored)
        data = await f.read()
        with open(path, "wb") as out:
            out.write(data)
        cur = conn.execute(
            "INSERT INTO attachment(product_id, filename, stored_name, kind, size) VALUES(?,?,?,?,?)",
            (pid, f.filename, stored, fkind, len(data)),
        )
        saved.append({"id": cur.lastrowid, "filename": f.filename, "kind": fkind})
    conn.commit()
    conn.close()
    return {"ok": True, "saved": saved}


@app.get("/api/attachments/{aid}/raw")
def raw_attachment(aid: int):
    conn = get_conn()
    a = conn.execute("SELECT * FROM attachment WHERE id=?", (aid,)).fetchone()
    conn.close()
    if a is None:
        raise HTTPException(404, "附件不存在")
    path = os.path.join(IMAGE_DIR if a["kind"] == "image" else FILE_DIR, a["stored_name"])
    if not os.path.exists(path):
        raise HTTPException(404, "文件已丢失")
    return FileResponse(path, filename=a["filename"])


@app.get("/api/attachments/{aid}/download")
def download_attachment(aid: int):
    conn = get_conn()
    a = conn.execute("SELECT * FROM attachment WHERE id=?", (aid,)).fetchone()
    conn.close()
    if a is None:
        raise HTTPException(404, "附件不存在")
    path = os.path.join(IMAGE_DIR if a["kind"] == "image" else FILE_DIR, a["stored_name"])
    if not os.path.exists(path):
        raise HTTPException(404, "文件已丢失")
    return FileResponse(path, filename=a["filename"])


@app.delete("/api/attachments/{aid}")
def delete_attachment(aid: int):
    conn = get_conn()
    a = conn.execute("SELECT * FROM attachment WHERE id=?", (aid,)).fetchone()
    if a:
        path = os.path.join(IMAGE_DIR if a["kind"] == "image" else FILE_DIR, a["stored_name"])
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
        conn.execute("DELETE FROM attachment WHERE id=?", (aid,))
        conn.commit()
    conn.close()
    return {"ok": True}


# ---------- 文件库 ----------

@app.get("/api/folders")
def list_folders():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM folder ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/folders")
def add_folder(payload: dict):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "文件夹名不能为空")
    conn = get_conn()
    try:
        cur = conn.execute("INSERT INTO folder(name) VALUES(?)", (name,))
        conn.commit()
        return {"id": cur.lastrowid, "name": name}
    except Exception:
        raise HTTPException(400, "文件夹已存在")
    finally:
        conn.close()


@app.delete("/api/folders/{fid}")
def del_folder(fid: int):
    conn = get_conn()
    row = conn.execute("SELECT name FROM folder WHERE id=?", (fid,)).fetchone()
    if row:
        files = conn.execute("SELECT * FROM file WHERE folder=?", (row["name"],)).fetchall()
        for f in files:
            path = os.path.join(LIBRARY_DIR, f["stored_name"])
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        conn.execute("DELETE FROM file WHERE folder=?", (row["name"],))
        conn.execute("DELETE FROM folder WHERE id=?", (fid,))
        conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/files")
def list_files(search: str = "", folder: Optional[str] = None):
    conn = get_conn()
    where = []
    args = []
    if search:
        where.append("filename LIKE ?")
        args.append(f"%{search}%")
    if folder is not None and folder != "__all__":
        where.append("folder = ?")
        args.append(folder)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = conn.execute(f"SELECT * FROM file {where_sql} ORDER BY id DESC", args).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/files")
async def upload_file(file: UploadFile = File(...), folder: str = Form("")):
    conn = get_conn()
    existing = conn.execute(
        "SELECT id FROM file WHERE filename=? AND folder=?", (file.filename, folder)
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(409, f"文件「{file.filename}」已存在，已跳过")
    ext = os.path.splitext(file.filename or "")[1]
    stored = uuid.uuid4().hex + ext
    path = os.path.join(LIBRARY_DIR, stored)
    data = await file.read()
    with open(path, "wb") as out:
        out.write(data)
    cur = conn.execute(
        "INSERT INTO file(filename, stored_name, folder, size) VALUES(?,?,?,?)",
        (file.filename, stored, folder, len(data)),
    )
    conn.commit()
    conn.close()
    return {"id": cur.lastrowid, "filename": file.filename, "folder": folder, "size": len(data)}


@app.get("/api/files/{fid}/download")
def download_file(fid: int):
    conn = get_conn()
    f = conn.execute("SELECT * FROM file WHERE id=?", (fid,)).fetchone()
    conn.close()
    if f is None:
        raise HTTPException(404, "文件不存在")
    path = os.path.join(LIBRARY_DIR, f["stored_name"])
    if not os.path.exists(path):
        raise HTTPException(404, "文件已丢失")
    return FileResponse(path, filename=f["filename"])


@app.delete("/api/files/{fid}")
def delete_file(fid: int):
    conn = get_conn()
    f = conn.execute("SELECT * FROM file WHERE id=?", (fid,)).fetchone()
    if f:
        path = os.path.join(LIBRARY_DIR, f["stored_name"])
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
        conn.execute("DELETE FROM file WHERE id=?", (fid,))
        conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/files/batch-download")
def batch_download(payload: dict):
    ids = payload.get("ids") or []
    if not ids:
        raise HTTPException(400, "未选择文件")
    conn = get_conn()
    placeholders = ",".join("?" for _ in ids)
    files = conn.execute(f"SELECT * FROM file WHERE id IN ({placeholders})", ids).fetchall()
    conn.close()
    if not files:
        raise HTTPException(404, "文件不存在")
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            path = os.path.join(LIBRARY_DIR, f["stored_name"])
            if os.path.exists(path):
                arcname = f["filename"]
                if f["folder"]:
                    arcname = f"{f['folder']}/{f['filename']}"
                zf.write(path, arcname)
    fname = f"文件下载_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"}
    return Response(content=zip_buf.getvalue(), media_type="application/zip", headers=headers)


@app.post("/api/files/batch-move")
def batch_move(payload: dict):
    ids = payload.get("ids") or []
    folder = payload.get("folder") or ""
    if not ids:
        raise HTTPException(400, "未选择文件")
    conn = get_conn()
    placeholders = ",".join("?" for _ in ids)
    conn.execute(f"UPDATE file SET folder=? WHERE id IN ({placeholders})", [folder] + ids)
    conn.commit()
    conn.close()
    return {"ok": True, "moved": len(ids)}


# ---------- 导出 / 导入 ----------

HEADERS = ["序号", "名称", "介绍", "参数", "型号", "市场价", "渠道价",
           "产品类型", "公司名称", "联系方式", "联系人", "标签"]


@app.get("/api/export")
def export_products(
    search: str = "",
    category_id: Optional[int] = None,
    company_id: Optional[int] = None,
    tag_id: Optional[int] = None,
):
    conn = get_conn()
    where = []
    args = []
    if search:
        like = f"%{search}%"
        where.append("(p.name LIKE ? OR p.model LIKE ? OR p.intro LIKE ? OR p.params LIKE ?)")
        args += [like, like, like, like]
    if category_id:
        where.append("p.category_id=?"); args.append(category_id)
    if company_id:
        where.append("p.company_id=?"); args.append(company_id)
    if tag_id:
        where.append("p.id IN (SELECT product_id FROM product_tag WHERE tag_id=?)"); args.append(tag_id)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = conn.execute(
        f"""SELECT p.*, c.name AS category_name, co.name AS company_name
            FROM product p LEFT JOIN category c ON p.category_id=c.id
            LEFT JOIN company co ON p.company_id=co.id {where_sql}
            ORDER BY CAST(p.seq AS INTEGER) ASC, p.id ASC""",
        args,
    ).fetchall()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "产品"
    ws.append(HEADERS)
    for c in ws[1]:
        c.font = Font(bold=True)
    for r in rows:
        tags = get_product_tags(conn, r["id"])
        tag_text = "、".join(t["name"] for t in tags)
        ws.append([
            r["seq"], r["name"], r["intro"], r["params"], r["model"],
            r["market_price"], r["channel_price"], r["category_name"],
            r["company_name"], r["contact_phone"], r["contact_person"], tag_text,
        ])
    conn.close()

    buf = io.BytesIO()
    wb.save(buf)
    fname = f"产品导出_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"}
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@app.get("/api/export/template")
def export_template():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "产品导入模板"
    ws.append(HEADERS)
    for c in ws[1]:
        c.font = Font(bold=True)
    ws.append(["001", "示例产品", "产品介绍", "参数说明", "A-100", 100, 80,
               "电子产品", "示例公司", "13800000000", "张三", "新品、热销"])
    buf = io.BytesIO()
    wb.save(buf)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote('product_template.xlsx')}"}
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


def get_or_create(conn, table, name):
    name = (name or "").strip()
    if not name:
        return None
    row = conn.execute(f"SELECT id FROM {table} WHERE name=?", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute(f"INSERT INTO {table}(name) VALUES(?)", (name,))
    return cur.lastrowid


def safe_sheet_name(name):
    for ch in ["\\", "/", "?", "*", "[", "]", ":"]:
        name = name.replace(ch, "")
    return (name or "未分类")[:31]


@app.post("/api/export/selected")
def export_selected(payload: dict):
    ids = payload.get("ids") or []
    if not ids:
        raise HTTPException(400, "未选择任何产品")
    conn = get_conn()
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""SELECT p.*, c.name AS category_name, co.name AS company_name
            FROM product p LEFT JOIN category c ON p.category_id=c.id
            LEFT JOIN company co ON p.company_id=co.id
            WHERE p.id IN ({placeholders}) ORDER BY c.name, CAST(p.seq AS INTEGER), p.id""",
        ids,
    ).fetchall()
    prod_info = {}
    for r in rows:
        pid = r["id"]
        tags = [t["name"] for t in get_product_tags(conn, pid)]
        atts = conn.execute("SELECT * FROM attachment WHERE product_id=?", (pid,)).fetchall()
        prod_info[pid] = {
            "tags": tags,
            "images": [a for a in atts if a["kind"] == "image"],
            "files": [a for a in atts if a["kind"] == "file"],
        }
    conn.close()

    # 前端传来的购物车价格覆盖（id -> {market_price, channel_price}），不落库
    overrides = {int(k): v for k, v in (payload.get("price_overrides") or {}).items()}

    groups = {}
    for r in rows:
        cat = r["category_name"] or "未分类"
        groups.setdefault(cat, []).append(r)

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    img_col = 13  # 图片列（第13列 = M）
    img_letter = openpyxl.utils.get_column_letter(img_col)
    grand_market = 0.0
    grand_channel = 0.0
    grand_count = 0
    for cat, items in groups.items():
        ws = wb.create_sheet(title=safe_sheet_name(cat))
        ws.append(["序号", "名称", "型号", "市场价", "渠道价", "产品类型",
                   "公司", "联系人", "联系方式", "标签", "介绍", "参数", "图片"])
        for c in ws[1]:
            c.font = Font(bold=True)
        cat_market = 0.0
        cat_channel = 0.0
        for idx, r in enumerate(items, start=2):
            info = prod_info[r["id"]]
            ov = overrides.get(r["id"], {})
            mp = ov.get("market_price", r["market_price"])
            cp = ov.get("channel_price", r["channel_price"])
            try: mp = float(mp) if mp is not None else None
            except (TypeError, ValueError): mp = r["market_price"]
            try: cp = float(cp) if cp is not None else None
            except (TypeError, ValueError): cp = r["channel_price"]
            if mp is not None: cat_market += mp
            if cp is not None: cat_channel += cp
            ws.append([
                r["seq"], r["name"], r["model"], mp, cp,
                r["category_name"], r["company_name"], r["contact_person"], r["contact_phone"],
                "、".join(info["tags"]), r["intro"], r["params"],
            ])
            imgs = info["images"]
            if imgs:
                path = os.path.join(IMAGE_DIR, imgs[0]["stored_name"])
                if os.path.exists(path):
                    try:
                        ximg = XLImage(path)
                        ximg.width = 90
                        ximg.height = 90
                        ws.add_image(ximg, f"{img_letter}{idx}")
                    except Exception:
                        pass
            ws.row_dimensions[idx].height = 70
        # 分组合计行
        sum_row = ws.max_row + 1
        ws.cell(row=sum_row, column=2, value="小计").font = Font(bold=True)
        ws.cell(row=sum_row, column=4, value=round(cat_market, 2)).font = Font(bold=True)
        ws.cell(row=sum_row, column=5, value=round(cat_channel, 2)).font = Font(bold=True)
        ws.cell(row=sum_row, column=6, value=f"{len(items)} 个产品").font = Font(bold=True)
        grand_market += cat_market
        grand_channel += cat_channel
        grand_count += len(items)
        widths = [8, 28, 16, 12, 12, 16, 18, 10, 14, 16, 40, 40, 14]
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    # 总计 sheet
    ws_total = wb.create_sheet(title="总计")
    ws_total.append(["项目", "数值"])
    ws_total.append(["产品总数（个）", grand_count])
    ws_total.append(["市场价合计（元）", round(grand_market, 2)])
    ws_total.append(["渠道价合计（元）", round(grand_channel, 2)])
    for c in ws_total[1]:
        c.font = Font(bold=True)
    for r in range(2, 5):
        ws_total.cell(row=r, column=1).font = Font(bold=True)
    ws_total.column_dimensions["A"].width = 22
    ws_total.column_dimensions["B"].width = 18

    excel_buf = io.BytesIO()
    wb.save(excel_buf)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("产品导出.xlsx", excel_buf.getvalue())
        for r in rows:
            files = prod_info[r["id"]]["files"]
            if not files:
                continue
            name_part = re.sub(r'[\\/:*?"<>|]', "", r["name"])[:30]
            for f in files:
                path = os.path.join(FILE_DIR, f["stored_name"])
                if os.path.exists(path):
                    arcname = f"附件/{r['seq']}_{name_part}_{f['filename']}"
                    zf.write(path, arcname)

    fname = f"选购产品_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"}
    return Response(
        content=zip_buf.getvalue(),
        media_type="application/zip",
        headers=headers,
    )


@app.post("/api/import")
async def import_products(file: UploadFile = File(...)):
    data = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data))
    except Exception:
        raise HTTPException(400, "无法解析文件，请上传 .xlsx 格式")
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "文件为空")
    header = [str(h).strip() if h else "" for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}

    def col(name):
        i = idx.get(name)
        return rows[r][i] if i is not None and i < len(rows[r]) else None

    conn = get_conn()
    created = 0
    errors = []
    for r in range(1, len(rows)):
        name = (col("名称") or "")
        if name is None or str(name).strip() == "":
            continue
        name = str(name).strip()
        category_id = get_or_create(conn, "category", str(col("产品类型") or ""))
        company_id = get_or_create(conn, "company", str(col("公司名称") or ""))
        try:
            cur = conn.execute(
                """INSERT INTO product(seq,name,intro,params,model,market_price,channel_price,
                   category_id,company_id,contact_phone,contact_person,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (str(col("序号") or ""), name, str(col("介绍") or ""), str(col("参数") or ""),
                 str(col("型号") or ""), col("市场价"), col("渠道价"), category_id, company_id,
                 str(col("联系方式") or ""), str(col("联系人") or ""), now()),
            )
            pid = cur.lastrowid
            tag_text = str(col("标签") or "")
            for t in [x for x in re_split_tags(tag_text) if x]:
                tid = get_or_create(conn, "tag", t)
                if tid:
                    conn.execute("INSERT OR IGNORE INTO product_tag(product_id, tag_id) VALUES(?,?)", (pid, tid))
            created += 1
        except Exception as e:
            errors.append(f"第{r+1}行: {e}")
    conn.commit()
    conn.close()
    return {"created": created, "errors": errors}


def re_split_tags(text):
    import re
    return re.split(r"[、,，;；/\\|]", text)


# ---------- 统计 ----------

@app.get("/api/stats")
def get_stats():
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM product").fetchone()[0]
    by_category = [dict(r) for r in conn.execute(
        "SELECT c.name AS name, COUNT(p.id) AS value FROM category c "
        "LEFT JOIN product p ON p.category_id=c.id GROUP BY c.id ORDER BY value DESC").fetchall()]
    by_company = [dict(r) for r in conn.execute(
        "SELECT co.name AS name, COUNT(p.id) AS value FROM company co "
        "LEFT JOIN product p ON p.company_id=co.id GROUP BY co.id ORDER BY value DESC").fetchall()]
    by_tag = [dict(r) for r in conn.execute(
        "SELECT t.name AS name, COUNT(pt.product_id) AS value FROM tag t "
        "LEFT JOIN product_tag pt ON pt.tag_id=t.id GROUP BY t.id ORDER BY value DESC").fetchall()]
    conn.close()
    return {"total": total, "by_category": by_category, "by_company": by_company, "by_tag": by_tag}


# ---------- 备份 ----------

@app.get("/api/backup")
def backup():
    if not os.path.exists(DB_PATH):
        raise HTTPException(404, "数据库文件不存在")
    fname = f"产品库备份_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
    return FileResponse(DB_PATH, filename=fname, media_type="application/octet-stream")


# ---------- 前端静态 ----------
# 关闭浏览器缓存，确保改代码后用户刷新即可拿到最新版本
@app.middleware("http")
async def no_cache_static(request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "static"), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
