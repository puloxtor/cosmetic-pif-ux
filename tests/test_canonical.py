"""AI канонизиране на INCI имена (UX слой). Моделът е мокнат — без мрежа/ключ."""
from fastapi.testclient import TestClient

from app.main import app
from app import canonical

client = TestClient(app)

ITEMS = [
    {"id": 0, "name": "HELIANTHUS ANNUUS SEED OIL", "kind": "composition", "context": "Слънчоглед"},
    {"id": 1, "name": "Sunflower Oil", "kind": "composition", "context": "Vitapherole"},
    {"id": 2, "name": "Iso E Super", "kind": "allergen", "context": "Parfum"},
    {"id": 3, "name": "Limonene", "kind": "allergen", "context": "Parfum"},
]


def test_canonicalize_maps_names_and_declarability(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(canonical, "_call_model", lambda items, model: {"items": [
        {"id": 0, "canonical": "Helianthus Annuus Seed Oil", "declarable": False, "drop": False},
        {"id": 1, "canonical": "Helianthus Annuus Seed Oil", "declarable": False, "drop": False},
        {"id": 2, "canonical": "Tetramethyl Acetyloctahydronaphthalenes", "declarable": False, "drop": False},
        {"id": 3, "canonical": "Limonene", "declarable": True, "drop": False},
    ]})
    res = canonical.canonicalize(ITEMS)
    assert res["available"] is True
    by = {it["id"]: it for it in res["items"]}
    assert by[0]["canonical"] == by[1]["canonical"] == "Helianthus Annuus Seed Oil"  # синоним → INCI
    assert by[2]["declarable"] is False                  # Iso E Super → не е декларируем
    assert by[3]["declarable"] is True                   # Limonene → декларируем


def test_canonicalize_filters_bad_ids(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(canonical, "_call_model", lambda items, model: {"items": [
        {"id": 9, "canonical": "X", "declarable": False, "drop": False},      # извън обхват
        {"id": 0, "canonical": "Helianthus Annuus Seed Oil", "declarable": False, "drop": False},
    ]})
    assert [it["id"] for it in canonical.canonicalize(ITEMS)["items"]] == [0]


def test_canonicalize_no_key_unavailable(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = canonical.canonicalize(ITEMS)
    assert res["available"] is False and res["items"] == []


def test_canonicalize_handles_failure(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")

    def boom(items, model):
        raise RuntimeError("api down")

    monkeypatch.setattr(canonical, "_call_model", boom)
    res = canonical.canonicalize(ITEMS)
    assert res["available"] is False and "api down" in res.get("note", "")


def test_canonicalize_empty_short_circuit():
    assert canonical.canonicalize([])["items"] == []


def test_canonicalize_endpoint_returns_json(monkeypatch):
    monkeypatch.setattr(canonical, "canonicalize", lambda items, model=None: {
        "available": True, "model": "stub",
        "items": [{"id": 0, "canonical": "Tocopherol", "declarable": False, "drop": False}]})
    r = client.post("/canonicalize", json={"items": ITEMS})
    assert r.status_code == 200
    assert r.json()["items"][0]["canonical"] == "Tocopherol"


def test_canonicalize_endpoint_no_key_graceful(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/canonicalize", json={"items": ITEMS})
    assert r.status_code == 200            # никога 500
    assert r.json()["available"] is False
