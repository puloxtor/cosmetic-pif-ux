"""UX smoke tests (no network). Engine is a real dependency; extraction is mocked."""
from fastapi.testclient import TestClient

from app.main import app, SAMPLE_FORMULA
from app import engine

client = TestClient(app)

MINI = """product:
  name: "T"
  product_type: "leave-on"
raw_materials:
  - name: "Almond"
    dose_pct: 100
    composition:
      - { inci_name: "Prunus Amygdalus Dulcis Oil", pct: 100 }
"""


def test_index_ok():
    r = client.get("/")
    assert r.status_code == 200
    assert "pif-engine" in r.text
    assert "Формула" in r.text


def test_compute_renders_table_and_inci():
    r = client.post("/compute", data={"formula": MINI})
    assert r.status_code == 200
    assert "Prunus Amygdalus Dulcis Oil" in r.text
    assert "Генериран INCI" in r.text


def test_compute_sample_default_works():
    r = client.post("/compute", data={"formula": SAMPLE_FORMULA})
    assert r.status_code == 200
    assert "Limonene" in r.text  # declared allergen from the sample parfum


def test_compute_bad_yaml_is_graceful():
    r = client.post("/compute", data={"formula": "not: a: valid: product"})
    assert r.status_code == 200
    assert "Не мога да изчисля" in r.text


def test_extract_endpoint_uses_engine(monkeypatch):
    monkeypatch.setattr(engine, "extract_document",
                        lambda data, fn, kind, ocr: "raw_materials:\n- name: X\n  dose_pct: 1\n")
    r = client.post("/extract",
                    data={"type": "composition", "ocr": "never"},
                    files={"file": ("x.pdf", b"%PDF-1.4 dummy", "application/pdf")})
    assert r.status_code == 200
    assert "raw_materials" in r.text and "ЧЕРНОВА" in r.text
