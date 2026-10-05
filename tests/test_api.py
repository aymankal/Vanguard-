import base64
import importlib

import pytest
from fastapi.testclient import TestClient


def make_client(tmp_path, monkeypatch, password="", case_password="case-secret"):
    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("RENDER", raising=False)
    for key, value in (("APP_PASSWORD", password), ("CASE_PASSWORD", case_password)):
        if value:
            monkeypatch.setenv(key, value)
        else:
            monkeypatch.delenv(key, raising=False)
    from vanguard import auth, db, main

    importlib.reload(auth)
    importlib.reload(db)
    importlib.reload(main)
    auth._failures.clear()
    return TestClient(main.app)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as c:
        yield c


def module(client, name="Client Contracts", code="CON"):
    r = client.post("/api/modules", json={"name": name, "code": code})
    assert r.status_code == 200, r.text
    return r.json()


def test_reference_numbers_follow_module_code(client):
    con = module(client)
    hr = module(client, "HR", "hr")
    assert hr["code"] == "HR"
    a = client.post("/api/documents", json={"title": "MSA Acme", "moduleId": con["id"], "tags": ["MSA", "msa", " uae "]}).json()
    b = client.post("/api/documents", json={"title": "MSA Globex", "moduleId": con["id"]}).json()
    c = client.post("/api/documents", json={"title": "Contract Dana", "moduleId": hr["id"]}).json()
    assert (a["ref"], b["ref"], c["ref"]) == ("VG-CON-0001", "VG-CON-0002", "VG-HR-0001")
    assert a["tags"] == ["msa", "uae"] and a["status"] == "Active"

    moved = client.patch(f"/api/documents/{a['id']}", json={"moduleId": hr["id"]}).json()
    assert moved["ref"] == "VG-HR-0002" and moved["title"] == "MSA Acme"
    same = client.patch(f"/api/documents/{moved['id']}", json={"status": "Expired"}).json()
    assert same["ref"] == "VG-HR-0002" and same["status"] == "Expired"


def test_validation(client):
    con = module(client)
    assert client.post("/api/modules", json={"name": "Dup", "code": "con"}).status_code == 409
    assert client.post("/api/modules", json={"name": "X", "code": "C"}).status_code == 400
    assert client.post("/api/modules", json={"name": "X", "code": "case"}).status_code == 400
    bad = [{"title": ""}, {"title": "x", "status": "Nope"}, {"title": "x", "link": "javascript:alert(1)"},
           {"title": "x", "expiry": "next week"}]
    for body in bad:
        assert client.post("/api/documents", json={"moduleId": con["id"], **body}).status_code == 400
    assert client.post("/api/documents", json={"title": "x", "moduleId": "999"}).status_code == 400


def test_module_delete_blocked_while_it_has_documents(client):
    con = module(client)
    doc = client.post("/api/documents", json={"title": "MSA", "moduleId": con["id"]}).json()
    assert client.delete(f"/api/modules/{con['id']}").status_code == 409
    client.delete(f"/api/documents/{doc['id']}")
    assert client.delete(f"/api/modules/{con['id']}").status_code == 200
    renamed = module(client, "Legal", "LEG")
    assert client.patch(f"/api/modules/{renamed['id']}", json={"code": "LGL"}).json()["code"] == "LGL"


def test_file_upload_download_replace_and_delete(client, tmp_path):
    con = module(client)
    doc = client.post("/api/documents", json={"title": "MSA", "moduleId": con["id"]}).json()
    r = client.put(f"/api/documents/{doc['id']}/file", params={"name": "../msa.pdf"}, content=b"%PDF-1.4 test")
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["hasFile"] and up["fileName"] == "msa.pdf" and up["fileSize"] == 13
    got = client.get(f"/api/documents/{doc['id']}/file")
    assert got.content == b"%PDF-1.4 test" and got.headers["content-type"] == "application/pdf"
    assert got.headers["content-disposition"].startswith("inline")
    assert got.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"/api/documents/{doc['id']}/file?download=1").headers["content-disposition"].startswith("attachment")

    client.put(f"/api/documents/{doc['id']}/file", params={"name": "terms.docx"}, content=b"PK docx")
    word = client.get(f"/api/documents/{doc['id']}/file")
    assert word.headers["content-disposition"].startswith("attachment")
    assert len(list((tmp_path / "files").iterdir())) == 1  # the replaced PDF is gone

    assert client.put(f"/api/documents/{doc['id']}/file", params={"name": "x.html"}, content=b"<script>").status_code == 415
    assert client.put(f"/api/documents/{doc['id']}/file", params={"name": "x.svg"}, content=b"<svg/>").status_code == 415
    assert client.put(f"/api/documents/{doc['id']}/file", params={"name": "x.pdf"}, content=b"").status_code == 400

    client.delete(f"/api/documents/{doc['id']}")
    assert list((tmp_path / "files").iterdir()) == []


def test_upload_size_limit(client, tmp_path, monkeypatch):
    from vanguard import main
    monkeypatch.setattr(main, "MAX_FILE_BYTES", 10)
    con = module(client)
    doc = client.post("/api/documents", json={"title": "MSA", "moduleId": con["id"]}).json()
    assert client.put(f"/api/documents/{doc['id']}/file", params={"name": "a.pdf"}, content=b"x" * 11).status_code == 413
    assert list((tmp_path / "files").iterdir()) == []
    assert not client.get("/api/state").json()["documents"][0]["hasFile"]


def test_case_file_needs_its_own_passcode(client):
    st = client.get("/api/state").json()
    assert st["case"] == {"enabled": True, "unlocked": False, "hours": 8}
    assert client.post("/api/documents", json={"title": "Evidence", "moduleId": "case"}).status_code == 403
    assert client.post("/api/case/unlock", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/case/unlock", json={"password": "case-secret"}).status_code == 200

    ev = client.post("/api/documents", json={"title": "Evidence", "moduleId": "case"}).json()
    assert ev["ref"] == "VG-CASE-0001" and ev["moduleId"] == "case"
    client.put(f"/api/documents/{ev['id']}/file", params={"name": "ev.pdf"}, content=b"%PDF secret")
    st = client.get("/api/state").json()
    assert [d["title"] for d in st["vault"]] == ["Evidence"] and st["documents"] == []

    client.post("/api/case/lock")
    st = client.get("/api/state").json()
    assert st["vault"] == [] and not st["case"]["unlocked"]
    assert client.get(f"/api/documents/{ev['id']}/file").status_code == 404
    assert client.patch(f"/api/documents/{ev['id']}", json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/documents/{ev['id']}").status_code == 404
    assert "secret" not in client.get("/api/export.json").text


def test_case_file_off_without_passcode(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch, case_password="") as c:
        assert c.get("/api/state").json()["case"]["enabled"] is False
        assert c.post("/api/case/unlock", json={"password": ""}).status_code == 409
        assert c.post("/api/documents", json={"title": "x", "moduleId": "case"}).status_code == 403


def test_moving_a_document_into_and_out_of_case_file(client):
    con = module(client)
    doc = client.post("/api/documents", json={"title": "Board minutes", "moduleId": con["id"]}).json()
    assert client.patch(f"/api/documents/{doc['id']}", json={"moduleId": "case"}).status_code == 403
    client.post("/api/case/unlock", json={"password": "case-secret"})
    moved = client.patch(f"/api/documents/{doc['id']}", json={"moduleId": "case"}).json()
    assert moved["ref"] == "VG-CASE-0001"
    back = client.patch(f"/api/documents/{doc['id']}", json={"moduleId": con["id"]}).json()
    assert back["ref"] == "VG-CON-0002" and back["moduleId"] == con["id"]


def test_reference_numbers_never_reused_after_delete(client):
    con = module(client)
    ids = [client.post("/api/documents", json={"title": f"D{i}", "moduleId": con["id"]}).json()["id"] for i in range(2)]
    client.delete(f"/api/documents/{ids[1]}")
    assert client.post("/api/documents", json={"title": "D3", "moduleId": con["id"]}).json()["ref"] == "VG-CON-0003"


def test_import_from_claude_ai_export_is_idempotent(client):
    export = {
        "modules": [{"id": "m1", "name": "Client Contracts", "code": "CON", "description": "MSAs", "order": 1},
                    {"id": "m2", "name": "HR", "code": "HR", "order": 2}],
        "documents": [
            {"moduleId": "m1", "title": "MSA Acme", "status": "Active", "ref": "VG-CON-0007", "seq": 7,
             "tags": ["msa"], "expiry": "2030-01-31", "createdAt": 1767225600000, "updatedAt": 1767225600000},
            {"moduleId": "m2", "title": "Offer letter", "status": "Weird", "ref": "VG-HR-0001", "seq": 1},
            {"moduleId": "gone", "title": "Orphan"},
        ],
        "vault": [{"title": "Evidence", "ref": "VG-CASE-0001", "seq": 1}],
    }
    assert client.post("/api/import", json=export).status_code == 403  # vault needs the Case File unlocked
    client.post("/api/case/unlock", json={"password": "case-secret"})
    r = client.post("/api/import", json=export).json()
    assert r == {"modules": 2, "documents": 3, "skipped": 1}
    again = client.post("/api/import", json=export).json()
    assert again == {"modules": 0, "documents": 0, "skipped": 4}

    st = client.get("/api/state").json()
    acme = next(d for d in st["documents"] if d["title"] == "MSA Acme")
    assert acme["ref"] == "VG-CON-0007" and acme["createdAt"] == "2026-01-01T00:00:00Z"
    assert next(d for d in st["documents"] if d["title"] == "Offer letter")["status"] == "Active"
    con_id = acme["moduleId"]
    nxt = client.post("/api/documents", json={"title": "Next", "moduleId": con_id}).json()
    assert nxt["ref"] == "VG-CON-0008"

    exported = client.get("/api/export.json").json()
    assert {d["ref"] for d in exported["vault"]} == {"VG-CASE-0001"}


def test_login_required_when_password_set(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch, password="pw") as c:
        assert c.get("/api/state").status_code == 401
        assert c.get("/", follow_redirects=False).headers["location"] == "/login"
        assert c.get("/healthz").status_code == 200 and c.get("/manifest.webmanifest").status_code == 200
        bad = c.post("/login", data={"username": "vanguard", "password": "nope"}, follow_redirects=False)
        assert bad.status_code == 401
        ok = c.post("/login", data={"username": " Vanguard ", "password": "pw", "next": "#/expiring"}, follow_redirects=False)
        assert ok.status_code == 303 and ok.headers["location"] == "/#/expiring"
        assert c.get("/api/state").status_code == 200
        c.post("/logout")
        assert c.get("/api/state").status_code == 401
        basic = base64.b64encode(b"vanguard:pw").decode()
        assert c.get("/api/state", headers={"Authorization": f"Basic {basic}"}).status_code == 200


def test_login_throttled(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch, password="pw") as c:
        for _ in range(8):
            c.post("/login", data={"username": "vanguard", "password": "x"})
        assert c.post("/login", data={"username": "vanguard", "password": "pw"}).status_code == 429


def test_shell_served(client):
    assert "Vanguard Docs" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/sw.js").headers["service-worker-allowed"] == "/"
