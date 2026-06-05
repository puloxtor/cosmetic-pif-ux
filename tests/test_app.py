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


def test_results_carry_draft_provenance_stamp():
    """Всеки изход носи ЧЕРНОВА/Член 10 печат (провенанс за подписващия оценител)."""
    r = client.post("/compute", data={"formula": MINI})
    assert "ЧЕРНОВА" in r.text
    assert "Член 10" in r.text


def test_clean_compute_does_not_gate_outputs():
    """Без аларми изходите се показват веднага — без бутон за потвърждение."""
    r = client.post("/compute", data={"formula": MINI})
    assert "data-ack-alarms" not in r.text
    assert 'class="gated" hidden' not in r.text
    assert "Генериран INCI" in r.text


def test_alarms_gate_outputs_until_acknowledged():
    """Аларма (сума≠100%) скрива INCI/CPSR зад задължително потвърждение."""
    bad = MINI.replace("dose_pct: 100", "dose_pct: 50")
    r = client.post("/compute", data={"formula": bad})
    assert "data-ack-alarms" in r.text             # блокиращ бутон за потвърждение
    assert 'class="gated" hidden' in r.text         # изходите са скрити
    # INCI секцията е вътре в скритата зона
    assert r.text.index('class="gated"') < r.text.index("Генериран INCI")


def test_extract_rejects_disallowed_extension():
    r = client.post("/extract", data={"type": "auto", "ocr": "never"},
                    files={"files": ("evil.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 200
    assert "Неподдържан тип файл" in r.text


def test_extract_rejects_oversize_file():
    big = b"%PDF" + b"x" * (10 * 1024 * 1024 + 16)
    r = client.post("/extract", data={"type": "auto", "ocr": "never"},
                    files={"files": ("big.pdf", big, "application/pdf")})
    assert r.status_code == 200
    assert "твърде голям" in r.text


def test_extract_rejects_too_many_files():
    files = [("files", (f"f{i}.pdf", b"%PDF", "application/pdf")) for i in range(21)]
    r = client.post("/extract", data={"type": "auto", "ocr": "never"}, files=files)
    assert r.status_code == 200
    assert "много файлове" in r.text


def test_compute_sample_default_works():
    r = client.post("/compute", data={"formula": SAMPLE_FORMULA})
    assert r.status_code == 200
    assert "Limonene" in r.text  # declared allergen from the sample parfum


def test_allergen_determination_table_shows_the_math():
    """Резултатите показват изчислената концентрация, прага и решението за INCI."""
    r = client.post("/compute", data={"formula": SAMPLE_FORMULA})
    assert r.status_code == 200
    assert "% в продукта" in r.text and "В INCI?" in r.text  # колоните на таблицата
    assert "0.12000" in r.text  # Limonene концентрация в продукта
    assert "0.04500" in r.text  # Linalool концентрация в продукта
    assert "0.001" in r.text    # прагът за leave-on
    assert "5989-27-5" in r.text  # CAS, взет от суровината


def test_precise_allergen_value_accepted_and_computed():
    """Стойност под 0.01 (напр. 0.007) минава и се изчислява коректно."""
    formula = """product:
  name: "Precise"
  product_type: "leave-on"
raw_materials:
  - name: "Parfum"
    dose_pct: 3.0
    is_fragrance: true
    allergens:
      - { name: "Citral", pct_in_fragrance: 0.007 }
"""
    r = client.post("/compute", data={"formula": formula})
    assert r.status_code == 200
    # 3% × 0.007% = 0.00021% в продукта; под прага 0.001 → НЕ влиза в INCI.
    assert "0.00021" in r.text


def test_input_steps_allow_any_precision():
    """Полетата за доза/алерген приемат произволна точност (step=any)."""
    r = client.get("/")
    assert 'id="p-amount" value="2.0" step="any"' in r.text


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


def _fake_extract(rms, notes):
    return lambda data, fn, kind, ocr: (rms, list(notes))


def test_extract_endpoint_returns_structured_draft(monkeypatch):
    rms = [{"name": "Sweet Almond Oil", "dose_pct": "TODO",
            "composition": [{"inci_name": "Prunus Amygdalus Dulcis Oil", "pct": 100}]}]
    monkeypatch.setattr(engine, "extract_structured", _fake_extract(rms, ["провери числата"]))
    r = client.post("/extract",
                    data={"type": "composition", "ocr": "never"},
                    files={"files": ("x.pdf", b"%PDF-1.4 dummy", "application/pdf")})
    assert r.status_code == 200
    assert "Sweet Almond Oil" in r.text          # дружелюбен преглед
    assert "data-add-all" in r.text               # бутон „добави всички“
    assert "data-add-one" in r.text               # бутон за една съставка
    assert "data-rms=" in r.text                  # структурирани данни за един клик
    assert 'class="di-dest"' in r.text            # избор: нова или допълни съществуваща
    assert 'class="di-conflicts"' in r.text       # място за разрешаване на конфликти
    assert "провери числата" in r.text            # бележки от сканирането


def test_extract_handles_multiple_files_and_per_file_error(monkeypatch):
    calls = {"n": 0}

    def flaky(data, fn, kind, ocr):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("Could not resolve authentication method: api_key")
        return ([{"name": "Water", "dose_pct": 50,
                  "composition": [{"inci_name": "Aqua", "pct": 100}]}], [])

    monkeypatch.setattr(engine, "extract_structured", flaky)
    r = client.post("/extract",
                    data={"type": "auto", "ocr": "auto"},
                    files=[("files", ("a.pdf", b"%PDF a", "application/pdf")),
                           ("files", ("b.jpg", b"\xff\xd8 b", "image/jpeg"))])
    assert r.status_code == 200
    assert "a.pdf" in r.text and "b.jpg" in r.text   # две карти
    assert 'role="alert"' in r.text                  # грешката за втория файл
    assert "ANTHROPIC_API_KEY" in r.text             # дружелюбно съобщение
