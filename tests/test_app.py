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


def test_index_has_form_builder():
    """Началната страница показва форма за съставки, не само суров YAML."""
    r = client.get("/")
    assert 'id="ingredients"' in r.text
    assert "Добави съставка" in r.text
    assert "/static/app.js" in r.text


def test_compute_renders_table_and_inci():
    r = client.post("/compute", data={"formula": MINI})
    assert r.status_code == 200
    assert "Prunus Amygdalus Dulcis Oil" in r.text
    assert "Генериран INCI" in r.text


def test_results_have_copy_button_and_sum_status():
    """Резултатите дават копи-бутон и текстов (не само цветен) индикатор за сумата."""
    r = client.post("/compute", data={"formula": MINI})
    assert 'data-copy="#inci-text"' in r.text
    assert "Сборът е 100%" in r.text  # 100% доза → пълен състав


def test_compute_sample_default_works():
    r = client.post("/compute", data={"formula": SAMPLE_FORMULA})
    assert r.status_code == 200
    assert "Limonene" in r.text  # declared allergen from the sample parfum


def test_compute_bad_yaml_is_graceful():
    r = client.post("/compute", data={"formula": "not: a: valid: product"})
    assert r.status_code == 200
    assert "Не мога да изчисля" in r.text
    assert 'role="alert"' in r.text  # достъпно съобщение за грешка


def test_friendly_error_maps_common_cases():
    """Суровите изключения се превеждат на разбираем език."""
    import yaml
    msg = engine.friendly_error(yaml.scanner.ScannerError("boom"))
    assert "структурата" in msg
    auth = engine.friendly_error(
        Exception("Could not resolve authentication method. Expected api_key"))
    assert "ANTHROPIC_API_KEY" in auth


def test_extract_endpoint_uses_engine(monkeypatch):
    monkeypatch.setattr(engine, "extract_document",
                        lambda data, fn, kind, ocr: "raw_materials:\n- name: X\n  dose_pct: 1\n")
    r = client.post("/extract",
                    data={"type": "composition", "ocr": "never"},
                    files={"file": ("x.pdf", b"%PDF-1.4 dummy", "application/pdf")})
    assert r.status_code == 200
    assert "raw_materials" in r.text and "ЧЕРНОВА" in r.text
