"""Vanguard Docs: the document-control register (modules, documents, files, Case File)."""

import datetime as dt
import os
import re
import secrets
import sqlite3
from contextlib import asynccontextmanager
from typing import Any, Optional, Union
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, db

STATUSES = ["Draft", "Active", "In review", "Expired", "Archived"]
CASE = "case"
CASE_CODE = "CASE"
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TAGS = 12
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")

# Only types that can never run script in the app's origin. Office files download, never render.
FILE_TYPES = {
    "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "webp": "image/webp", "gif": "image/gif", "heic": "image/heic",
    "csv": "text/csv", "md": "text/markdown", "json": "application/json", "txt": "text/plain",
    "doc": "application/msword", "xls": "application/vnd.ms-excel", "ppt": "application/vnd.ms-powerpoint",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"}
TEXT_TYPES = {"text/csv", "text/markdown", "application/json", "text/plain"}


@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    yield


app = FastAPI(title="Vanguard Docs", lifespan=lifespan)


# -------------------------------------------------------------------- auth
def ensure_password() -> None:
    """Never serve the register publicly on a cloud host by accident.

    On Render (RENDER is set by the platform) without APP_PASSWORD, generate one for this
    run and print it to the logs; set APP_PASSWORD in the dashboard to make it permanent.
    """
    if os.environ.get("APP_PASSWORD") or not os.environ.get("RENDER"):
        return
    os.environ["APP_PASSWORD"] = secrets.token_urlsafe(9)
    print(
        "\n" + "=" * 64
        + f"\nAPP_PASSWORD is not set. Temporary login for this run:\n"
        f"  username: {os.environ.get('APP_USERNAME') or 'vanguard'}\n  password: {os.environ['APP_PASSWORD']}\n"
        "Set APP_PASSWORD under Environment to keep a fixed password.\n" + "=" * 64,
        flush=True,
    )


ensure_password()


@app.middleware("http")
async def require_login(request: Request, call_next):
    """When APP_PASSWORD is set, everything except sign-in and install assets needs a session."""
    if not auth.enabled() or auth.is_public(request.url.path) or auth.authorized(request):
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        # No WWW-Authenticate header: browsers must not pop up their native login box.
        return JSONResponse({"detail": "Sign in required"}, status_code=401)
    return RedirectResponse("/login", status_code=303)


@app.get("/login")
def login_form(request: Request):
    if not auth.enabled() or auth.authorized(request):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(auth.login_page())


@app.post("/login")
async def login_submit(request: Request):
    form = auth.parse_form(await request.body())
    username, next_hash = form.get("username", ""), auth.safe_next(form.get("next", ""))
    wait = auth.locked_for(request)
    if wait:
        return HTMLResponse(auth.login_page(auth.locked_message(wait), username, next_hash), status_code=429)
    if not auth.check_credentials(username, form.get("password", "")):
        auth.record_failure(request)
        return HTMLResponse(auth.login_page(auth.FAILED, username, next_hash), status_code=401)
    auth.clear_failures(request)
    response = RedirectResponse("/" + next_hash, status_code=303)
    secure = request.url.scheme == "https"
    response.headers["set-cookie"] = auth.cookie_header(auth.COOKIE, auth.make_session(), secure, auth.SESSION_DAYS * 86400)
    return response


@app.post("/logout")
def logout(request: Request):
    secure = request.url.scheme == "https"
    response = RedirectResponse("/login", status_code=303)
    response.headers.append("set-cookie", auth.cookie_header(auth.COOKIE, "", secure, 0))
    response.headers.append("set-cookie", auth.cookie_header(auth.CASE_COOKIE, "", secure, 0))
    return response


class CaseUnlockIn(BaseModel):
    password: str = ""


@app.post("/api/case/unlock")
def case_unlock(body: CaseUnlockIn, request: Request):
    if not auth.case_enabled():
        raise HTTPException(409, "The Case File is switched off. Set CASE_PASSWORD on the server to enable it.")
    wait = auth.locked_for(request)
    if wait:
        raise HTTPException(429, auth.locked_message(wait))
    if not auth.check_case_password(body.password):
        auth.record_failure(request)
        raise HTTPException(401, "Wrong Case File passcode.")
    auth.clear_failures(request)
    response = JSONResponse({"ok": True, "hours": auth.CASE_HOURS})
    response.headers["set-cookie"] = auth.cookie_header(
        auth.CASE_COOKIE, auth.make_case_session(), request.url.scheme == "https", auth.CASE_HOURS * 3600)
    return response


@app.post("/api/case/lock")
def case_lock(request: Request):
    response = JSONResponse({"ok": True})
    response.headers["set-cookie"] = auth.cookie_header(auth.CASE_COOKIE, "", request.url.scheme == "https", 0)
    return response


# ----------------------------------------------------------------- helpers
def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def module_out(row: sqlite3.Row) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "code": row["code"],
            "description": row["description"], "order": row["sort_order"]}


def doc_out(row: sqlite3.Row) -> dict:
    return {
        "id": str(row["id"]), "moduleId": CASE if row["is_case"] else str(row["module_id"]),
        "ref": row["ref"], "seq": row["seq"], "title": row["title"], "status": row["status"],
        "party": row["party"], "expiry": row["expiry"],
        "tags": [t for t in row["tags"].split(",") if t], "link": row["link"], "notes": row["notes"],
        "hasFile": bool(row["file_id"]), "fileName": row["file_name"], "fileType": row["file_type"],
        "fileSize": row["file_size"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


def clean_code(code: str) -> str:
    code = re.sub(r"[^A-Z]", "", (code or "").upper())
    if not 2 <= len(code) <= 4:
        raise HTTPException(400, "Use a 2 to 4 letter code.")
    if code == CASE_CODE:
        raise HTTPException(400, "CASE is reserved for the Case File.")
    return code


def resolve_module(conn, module_id: Union[str, int, None], request: Request) -> tuple[Optional[int], bool, str]:
    """Returns (module_id, is_case, code) for a module reference from the client."""
    if str(module_id) == CASE:
        require_case(request)
        return None, True, CASE_CODE
    try:
        mid = int(module_id)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise HTTPException(400, "Pick a module.")
    row = conn.execute("SELECT code FROM modules WHERE id = ?", (mid,)).fetchone()
    if not row:
        raise HTTPException(400, "That module no longer exists.")
    return mid, False, row["code"]


def require_case(request: Request) -> None:
    if not auth.case_unlocked(request):
        raise HTTPException(403, "Unlock the Case File first.")


def get_doc(conn, doc_id: int, request: Request) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    # A locked Case File record answers exactly like a missing one.
    if not row or (row["is_case"] and not auth.case_unlocked(request)):
        raise HTTPException(404, "Document not found")
    return row


def next_ref(conn, module_id: Optional[int], is_case: bool, code: str, at_least: int = 0) -> tuple[int, str]:
    """Issues the next reference number for a module. Numbers are never reused."""
    scope = CASE if is_case else f"m{module_id}"
    if is_case:
        top = conn.execute("SELECT MAX(seq) FROM documents WHERE is_case = 1").fetchone()[0]
    else:
        top = conn.execute("SELECT MAX(seq) FROM documents WHERE is_case = 0 AND module_id = ?", (module_id,)).fetchone()[0]
    counter = conn.execute("SELECT last_seq FROM ref_counters WHERE scope = ?", (scope,)).fetchone()
    seq = max(top or 0, counter["last_seq"] if counter else 0) + 1
    seq = max(seq, at_least)
    conn.execute("INSERT INTO ref_counters (scope, last_seq) VALUES (?, ?) "
                 "ON CONFLICT(scope) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)", (scope, seq))
    return seq, f"VG-{code}-{seq:04d}"


def clean_doc_fields(body: "DocIn", partial: bool) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if body.title is not None or not partial:
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(400, "Give the document a title.")
        out["title"] = title[:160]
    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(400, "Unknown status.")
        out["status"] = body.status
    if body.party is not None:
        out["party"] = body.party.strip()[:120]
    if body.expiry is not None:
        expiry = body.expiry.strip()
        if expiry:
            try:
                dt.date.fromisoformat(expiry)
            except ValueError:
                raise HTTPException(400, "Expiry must be a date (YYYY-MM-DD).")
        out["expiry"] = expiry
    if body.tags is not None:
        tags = body.tags if isinstance(body.tags, list) else body.tags.split(",")
        seen: list[str] = []
        for t in tags:
            t = str(t).strip().lower().replace(",", " ")[:40]
            if t and t not in seen:
                seen.append(t)
        out["tags"] = ",".join(seen[:MAX_TAGS])
    if body.link is not None:
        link = body.link.strip()
        if link and not re.match(r"^https?://", link, re.I):
            raise HTTPException(400, "Links must start with https://")
        out["link"] = link[:1000]
    if body.notes is not None:
        out["notes"] = body.notes.strip()[:4000]
    return out


def delete_file(file_id: str) -> None:
    if file_id and re.fullmatch(r"[A-Za-z0-9_-]+", file_id):
        try:
            os.remove(os.path.join(db.FILES_DIR, file_id))
        except FileNotFoundError:
            pass


# ----------------------------------------------------------------- state
@app.get("/api/state")
def state(request: Request):
    unlocked = auth.case_unlocked(request)
    with db.session() as conn:
        modules = [module_out(r) for r in conn.execute("SELECT * FROM modules ORDER BY sort_order, name")]
        docs = [doc_out(r) for r in conn.execute("SELECT * FROM documents WHERE is_case = 0")]
        vault = [doc_out(r) for r in conn.execute("SELECT * FROM documents WHERE is_case = 1")] if unlocked else []
    return {
        "modules": modules, "documents": docs, "vault": vault, "statuses": STATUSES,
        "case": {"enabled": auth.case_enabled(), "unlocked": unlocked, "hours": auth.CASE_HOURS},
        "auth": auth.enabled(), "maxFileBytes": MAX_FILE_BYTES, "fileTypes": sorted(FILE_TYPES),
    }


# ---------------------------------------------------------------- modules
class ModuleIn(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None


@app.post("/api/modules")
def create_module(body: ModuleIn):
    name = (body.name or "").strip()[:60]
    if not name:
        raise HTTPException(400, "Name the module.")
    code = clean_code(body.code or "")
    with db.session() as conn:
        if conn.execute("SELECT 1 FROM modules WHERE code = ?", (code,)).fetchone():
            raise HTTPException(409, f"Code {code} is already used by another module.")
        order = (conn.execute("SELECT MAX(sort_order) FROM modules").fetchone()[0] or 0) + 1
        cur = conn.execute("INSERT INTO modules (name, code, description, sort_order) VALUES (?, ?, ?, ?)",
                           (name, code, (body.description or "").strip()[:160], order))
        return module_out(conn.execute("SELECT * FROM modules WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.patch("/api/modules/{module_id}")
def update_module(module_id: int, body: ModuleIn):
    with db.session() as conn:
        if not conn.execute("SELECT 1 FROM modules WHERE id = ?", (module_id,)).fetchone():
            raise HTTPException(404, "Module not found")
        fields: dict[str, Any] = {}
        if body.name is not None:
            if not body.name.strip():
                raise HTTPException(400, "Name the module.")
            fields["name"] = body.name.strip()[:60]
        if body.code is not None:
            code = clean_code(body.code)
            if conn.execute("SELECT 1 FROM modules WHERE code = ? AND id != ?", (code, module_id)).fetchone():
                raise HTTPException(409, f"Code {code} is already used by another module.")
            fields["code"] = code  # existing reference numbers keep their original code
        if body.description is not None:
            fields["description"] = body.description.strip()[:160]
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE modules SET {sets} WHERE id = ?", (*fields.values(), module_id))
        return module_out(conn.execute("SELECT * FROM modules WHERE id = ?", (module_id,)).fetchone())


@app.delete("/api/modules/{module_id}")
def delete_module(module_id: int):
    with db.session() as conn:
        n = conn.execute("SELECT COUNT(*) FROM documents WHERE module_id = ?", (module_id,)).fetchone()[0]
        if n:
            raise HTTPException(409, f"Move or delete its {n} document{'s' if n > 1 else ''} first.")
        conn.execute("DELETE FROM modules WHERE id = ?", (module_id,))
        conn.execute("DELETE FROM ref_counters WHERE scope = ?", (f"m{module_id}",))
    return {"ok": True}


# -------------------------------------------------------------- documents
class DocIn(BaseModel):
    title: Optional[str] = None
    moduleId: Optional[Union[str, int]] = None
    status: Optional[str] = None
    party: Optional[str] = None
    expiry: Optional[str] = None
    tags: Optional[Union[list[str], str]] = None
    link: Optional[str] = None
    notes: Optional[str] = None


@app.post("/api/documents")
def create_document(body: DocIn, request: Request):
    fields = clean_doc_fields(body, partial=False)
    fields.setdefault("status", "Active")
    with db.session() as conn:
        module_id, is_case, code = resolve_module(conn, body.moduleId, request)
        seq, ref = next_ref(conn, module_id, is_case, code)
        fields.update(module_id=module_id, is_case=int(is_case), seq=seq, ref=ref)
        cols = ", ".join(fields)
        cur = conn.execute(f"INSERT INTO documents ({cols}) VALUES ({', '.join('?' * len(fields))})", tuple(fields.values()))
        return doc_out(conn.execute("SELECT * FROM documents WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.patch("/api/documents/{doc_id}")
def update_document(doc_id: int, body: DocIn, request: Request):
    fields = clean_doc_fields(body, partial=True)
    with db.session() as conn:
        row = get_doc(conn, doc_id, request)
        if body.moduleId is not None:
            module_id, is_case, code = resolve_module(conn, body.moduleId, request)
            if module_id != row["module_id"] or int(is_case) != row["is_case"]:
                seq, ref = next_ref(conn, module_id, is_case, code)
                fields.update(module_id=module_id, is_case=int(is_case), seq=seq, ref=ref)
        fields["updated_at"] = now_iso()
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE documents SET {sets} WHERE id = ?", (*fields.values(), doc_id))
        return doc_out(conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone())


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, request: Request):
    with db.session() as conn:
        row = get_doc(conn, doc_id, request)
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    delete_file(row["file_id"])
    return {"ok": True, "ref": row["ref"]}


# ------------------------------------------------------------------ files
@app.put("/api/documents/{doc_id}/file")
async def upload_file(doc_id: int, request: Request, name: str = ""):
    name = os.path.basename(name.replace("\\", "/")).strip()[:200]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in FILE_TYPES:
        raise HTTPException(415, "That file type can't be stored. Use PDF, an image, Word, Excel, PowerPoint, CSV or text.")
    with db.session() as conn:
        get_doc(conn, doc_id, request)
    file_id = secrets.token_urlsafe(18)
    path = os.path.join(db.FILES_DIR, file_id)
    size = 0
    try:
        with open(path, "wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, f"That file is over {MAX_FILE_BYTES // 1048576} MB. Compress it or add a link instead.")
                fh.write(chunk)
        if not size:
            raise HTTPException(400, "That file is empty.")
        with db.session() as conn:
            row = get_doc(conn, doc_id, request)  # re-read: the record may have changed during the upload
            conn.execute("UPDATE documents SET file_id = ?, file_name = ?, file_type = ?, file_size = ?, updated_at = ? WHERE id = ?",
                         (file_id, name, FILE_TYPES[ext], size, now_iso(), doc_id))
            out = doc_out(conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone())
    except BaseException:
        delete_file(file_id)
        raise
    delete_file(row["file_id"])
    return out


@app.delete("/api/documents/{doc_id}/file")
def remove_file(doc_id: int, request: Request):
    with db.session() as conn:
        row = get_doc(conn, doc_id, request)
        conn.execute("UPDATE documents SET file_id = '', file_name = '', file_type = '', file_size = 0, updated_at = ? WHERE id = ?",
                     (now_iso(), doc_id))
        out = doc_out(conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone())
    delete_file(row["file_id"])
    return out


@app.get("/api/documents/{doc_id}/file")
def get_file(doc_id: int, request: Request, download: bool = False):
    with db.session() as conn:
        row = get_doc(conn, doc_id, request)
    path = os.path.join(db.FILES_DIR, row["file_id"]) if row["file_id"] else ""
    if not path or not os.path.exists(path):
        raise HTTPException(404, "No file attached")
    ctype = row["file_type"] or "application/octet-stream"
    inline = not download and (ctype in INLINE_TYPES or ctype in TEXT_TYPES)
    media = "text/plain; charset=utf-8" if inline and ctype in TEXT_TYPES else ctype
    disposition = f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(row['file_name'] or 'document')}"
    headers = {"Content-Disposition": disposition, "X-Content-Type-Options": "nosniff",
               "Cache-Control": "private, no-store"}
    return FileResponse(path, media_type=media, headers=headers)


# ------------------------------------------------------- import and export
class ImportIn(BaseModel):
    modules: list[dict] = []
    documents: list[dict] = []
    vault: list[dict] = []


@app.post("/api/import")
def import_register(body: ImportIn, request: Request):
    """Loads a register exported from the claude.ai version (or from /api/export.json).

    Modules match on code, documents on reference number, so running it twice adds nothing.
    Files are not included in an export; records keep their links and get re-attached by hand.
    """
    if body.vault:
        require_case(request)
    added = {"modules": 0, "documents": 0, "skipped": 0}
    with db.session() as conn:
        id_map: dict[str, int] = {}
        for m in sorted(body.modules, key=lambda m: m.get("order") or 0):
            try:
                code = clean_code(str(m.get("code", "")))
            except HTTPException:
                continue
            row = conn.execute("SELECT id FROM modules WHERE code = ?", (code,)).fetchone()
            if not row:
                order = (conn.execute("SELECT MAX(sort_order) FROM modules").fetchone()[0] or 0) + 1
                cur = conn.execute("INSERT INTO modules (name, code, description, sort_order) VALUES (?, ?, ?, ?)",
                                   (str(m.get("name") or code)[:60], code, str(m.get("description") or "")[:160], order))
                added["modules"] += 1
                id_map[str(m.get("id"))] = cur.lastrowid
            else:
                id_map[str(m.get("id"))] = row["id"]
        for d in [*body.documents, *[{**v, "moduleId": CASE} for v in body.vault]]:
            is_case = d.get("moduleId") == CASE
            module_id = None if is_case else id_map.get(str(d.get("moduleId")))
            if not is_case and module_id is None:
                added["skipped"] += 1
                continue
            try:
                fields = clean_doc_fields(DocIn(**{k: d.get(k) for k in ("title", "party", "expiry", "tags", "link", "notes")},
                                                status=d.get("status") if d.get("status") in STATUSES else "Active"),
                                          partial=False)
            except (HTTPException, ValueError):
                added["skipped"] += 1
                continue
            ref = str(d.get("ref") or "")
            if ref and conn.execute("SELECT 1 FROM documents WHERE ref = ?", (ref,)).fetchone():
                added["skipped"] += 1
                continue
            code = CASE_CODE if is_case else conn.execute("SELECT code FROM modules WHERE id = ?", (module_id,)).fetchone()["code"]
            imported_seq = d.get("seq") if ref and isinstance(d.get("seq"), int) else 0
            seq, new_ref = next_ref(conn, module_id, is_case, code, at_least=imported_seq)
            fields.update(module_id=module_id, is_case=int(is_case), seq=seq, ref=ref or new_ref)
            for key, col in (("createdAt", "created_at"), ("updatedAt", "updated_at")):
                stamp = to_iso(d.get(key))
                if stamp:
                    fields[col] = stamp
            cols = ", ".join(fields)
            conn.execute(f"INSERT INTO documents ({cols}) VALUES ({', '.join('?' * len(fields))})", tuple(fields.values()))
            added["documents"] += 1
    return added


def to_iso(value: Any) -> str:
    if isinstance(value, (int, float)) and value > 0:  # epoch milliseconds from the claude.ai version
        return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}T", value):
        return value
    return ""


@app.get("/api/export.json")
def export_register(request: Request):
    data = state(request)
    body = {"exportedAt": now_iso(), "modules": data["modules"], "documents": data["documents"], "vault": data["vault"]}
    stamp = dt.date.today().isoformat()
    return JSONResponse(body, headers={"Content-Disposition": f'attachment; filename="vanguard-register-{stamp}.json"',
                                       "Cache-Control": "no-store"})


# ------------------------------------------------------------------ shell
@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(os.path.join(FRONTEND_DIR, "manifest.webmanifest"), media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    # Served from the root so the worker controls the whole app.
    return FileResponse(os.path.join(FRONTEND_DIR, "sw.js"), media_type="text/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
