"""AI съпоставяне документ→ред (UX слой). Моделът е мокнат — без мрежа/ключ.

Тестваме само UX логиката: валидиране на изхода, поведение без ключ/при грешка,
и че /match връща JSON (никога 500). Истинският модел е извън обхвата (генерализира
за произволни комплекти — не привързваме теста към конкретни файлове).
"""
from fastapi.testclient import TestClient

from app.main import app
from app import matching

client = TestClient(app)

ROWS = [{"i": 0, "name": "Бадемово масло"}, {"i": 1, "name": "жожоба"}]
DOCS = [
    {"j": 0, "filename": "Almond Oil.pdf", "inci": ["Prunus Amygdalus Dulcis Oil"],
     "allergens": [], "role": "ingredient"},
    {"j": 1, "filename": "AOT-SPEC_Jojoba.PDF", "inci": ["Simmondsia Chinensis Seed Oil"],
     "allergens": [], "role": "ingredient"},
]


def test_match_documents_validates_and_returns(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(matching, "_call_model", lambda rows, docs, model: {"matches": [
        {"doc": 0, "row": 0, "matched": True, "confidence": 0.99, "why": "almond=бадемово"},
        {"doc": 1, "row": 1, "matched": True, "confidence": 0.97, "why": "jojoba=жожоба"},
    ]})
    res = matching.match_documents(ROWS, DOCS)
    assert res["available"] is True
    assert {m["doc"]: m["row"] for m in res["matches"]} == {0: 0, 1: 1}
    assert all(m["matched"] for m in res["matches"])


def test_match_documents_filters_bad_indices(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(matching, "_call_model", lambda r, d, m: {"matches": [
        {"doc": 0, "row": 9, "matched": True, "confidence": 1.0, "why": "row out of range"},
        {"doc": 5, "row": 0, "matched": True, "confidence": 1.0, "why": "doc out of range"},
        {"doc": 1, "row": 0, "matched": False, "confidence": 0.2, "why": "unsure"},
    ]})
    res = matching.match_documents(ROWS, DOCS)
    by_doc = {m["doc"]: m for m in res["matches"]}
    assert by_doc[0]["matched"] is False and by_doc[0]["row"] == -1   # row 9 невалиден
    assert 5 not in by_doc                                            # doc 5 невалиден → отпада
    assert by_doc[1]["matched"] is False                             # изрично несигурно


def test_match_documents_no_key_is_unavailable(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = matching.match_documents(ROWS, DOCS)
    assert res["available"] is False
    assert res["matches"] == []


def test_match_documents_handles_call_failure(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")

    def boom(r, d, m):
        raise RuntimeError("network down")

    monkeypatch.setattr(matching, "_call_model", boom)
    res = matching.match_documents(ROWS, DOCS)
    assert res["available"] is False
    assert "network down" in res.get("note", "")


def test_match_documents_empty_inputs_short_circuit():
    assert matching.match_documents([], [])["matches"] == []
    assert matching.match_documents(ROWS, [])["available"] is True   # няма документи → нищо за смятане


def test_match_endpoint_returns_json(monkeypatch):
    monkeypatch.setattr(matching, "match_documents", lambda rows, docs, model=None: {
        "available": True, "model": "stub",
        "matches": [{"doc": 0, "row": 0, "matched": True, "confidence": 1.0, "why": "x"}]})
    r = client.post("/match", json={"rows": ROWS, "docs": DOCS})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True and body["matches"][0]["row"] == 0


def test_match_endpoint_no_key_is_graceful(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/match", json={"rows": ROWS, "docs": DOCS})
    assert r.status_code == 200          # никога 500
    assert r.json()["available"] is False
