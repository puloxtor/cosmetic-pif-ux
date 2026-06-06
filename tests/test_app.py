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


# Известният замърсен вход (правни бележки, адрес, спец-редове, page furniture),
# смесен с реални материали — както се появи в реален даташийт.
_CONTAMINATED = [
    {"name": "VegeLight 1818", "dose_pct": "TODO", "composition": [
        {"inci_name": "Prunus Amygdalus Dulcis Oil", "pct": 69.5},
        {"inci_name": "Tocopherol", "pct": 0.5},
        {"inci_name": "REACh Status Reg. EC 1907 2006 exempt", "pct": 6.255},
        {"inci_name": "Country of origin: refined in Italy", "pct": 3.475},
        {"inci_name": "Limit ppm Declaration limit", "pct": 2.085},
        {"inci_name": "Am Mühlbach 38, 69412 Eberbach", "pct": 0.99},
        {"inci_name": "C20:1 Gadoleinsäure", "pct": 1.2},
        {"inci_name": "C22:1 Erukasäure", "pct": 0.8},
        {"inci_name": "Seite 1 von 3", "pct": 0.5},
        {"inci_name": "Tel +49 6271 Fax 12345", "pct": 0.3},
        {"inci_name": "CI 77491", "pct": 0.2},
    ]},
    {"name": "Ricinusöl", "dose_pct": "TODO", "composition": [
        {"inci_name": "Ricinus Communis Seed Oil", "pct": 100},
        {"inci_name": "Declaration limit according to Annex V", "pct": 5.0},
    ]},
]
_BOILERPLATE = ["REACh", "Country of origin", "Limit ppm", "Declaration limit",
                "Mühlbach", "Gadoleinsäure", "Erukasäure", "C20:1", "C22:1",
                "Seite", "Fax", "Annex"]
_REAL = {"Prunus Amygdalus Dulcis Oil", "Tocopherol", "CI 77491",
         "Ricinus Communis Seed Oil"}


def test_extraction_strips_boilerplate_keeps_real_materials():
    """Замърсеният вход не бива да става съставки — само реалните INCI остават."""
    import copy
    rms, dropped = engine.filter_candidates(copy.deepcopy(_CONTAMINATED))
    kept = {c["inci_name"] for rm in rms for c in rm["composition"]}
    assert kept == _REAL                         # точно реалните материали
    for bad in _BOILERPLATE:
        assert all(bad not in c["inci_name"]      # никаква боклук-фраза не остава
                   for rm in rms for c in rm["composition"]), bad
    assert dropped == 9                           # 7 в първия + 2 във втория документ


def test_extract_route_never_emits_boilerplate_as_ingredient(monkeypatch):
    """През /extract: черновата не съдържа правни/адресни/спец редове."""
    monkeypatch.setattr(engine, "extract_drafts",
                        lambda *a, **k: ([dict(_CONTAMINATED[0])], []))
    r = client.post("/extract", data={"type": "composition", "ocr": "never"},
                    files={"files": ("datasheet.pdf", b"%PDF dummy", "application/pdf")})
    assert r.status_code == 200
    assert "Prunus Amygdalus Dulcis Oil" in r.text          # реалната съставка остава
    for bad in _BOILERPLATE:
        assert bad not in r.text, bad                        # боклукът не достига UI/съхранение
    assert "не приличат на INCI" in r.text                   # бележка за пропуснатите редове


def test_assembled_set_yields_clean_inci_without_raw_names():
    """Сглобен комплект (рецепта + документи) → чист INCI само с реални INCI имена.

    Точно това разваляше изхода преди: ред без INCI пускаше българското/търговско
    име на суровината в INCI списъка. Тук проверяваме формата, който фронтендът
    вече сглобява — имената на суровините не бива да се появяват в изхода.
    """
    formula = """product:
  name: "Beard Oil"
  product_type: "leave-on"
  applied_amount_g: 2.0
  retention_factor: 1.0
  sale_countries: ["BG"]

raw_materials:
  - name: "Бадемово масло"
    dose_pct: 69.5
    composition:
      - { inci_name: "Prunus Amygdalus Dulcis Oil", pct: 100 }
  - name: "Рицилово масло"
    dose_pct: 27.5
    composition:
      - { inci_name: "Ricinus Communis Seed Oil", pct: 100 }
  - name: "Peace fragrance"
    dose_pct: 3.0
    is_fragrance: true
    allergens:
      - { name: "Limonene", pct_in_fragrance: 4.0 }
"""
    r = client.post("/compute", data={"formula": formula})
    assert r.status_code == 200
    assert "Prunus Amygdalus Dulcis Oil" in r.text
    assert "Ricinus Communis Seed Oil" in r.text
    # имената на суровините (български/търговски) НЕ бива да изтичат в изхода/INCI
    assert "Бадемово масло" not in r.text
    assert "Рицилово масло" not in r.text
    assert "Peace fragrance" not in r.text


def test_extract_falls_back_to_vision_when_deterministic_empty(monkeypatch):
    """Ако детерминистичното четене не намери състав, препрочита с AI-зрение."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    seen = []

    def fake(path, kind, ocr_mode, name):
        seen.append(ocr_mode)
        if ocr_mode == "force":
            return ([{"name": name, "composition": [
                {"inci_name": "Prunus Amygdalus Dulcis Oil", "pct": 100}]}], [])
        return ([{"name": name, "composition": []}], [])     # детерминистично: нищо

    monkeypatch.setattr(engine, "extract_drafts", fake)
    rms, notes = engine.extract_structured(b"%PDF dummy", "Almond Oil.pdf", "composition", "auto")
    assert "force" in seen                                    # препрочетено с AI-зрение
    assert any(c["inci_name"] == "Prunus Amygdalus Dulcis Oil"
               for rm in rms for c in rm.get("composition", []))


def test_extract_no_vision_fallback_without_key(monkeypatch):
    """Без ключ не се опитва AI-зрение (само едно четене)."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    seen = []

    monkeypatch.setattr(engine, "extract_drafts",
                        lambda path, kind, ocr_mode, name: seen.append(ocr_mode) or
                        ([{"name": name, "composition": []}], []))
    engine.extract_structured(b"%PDF", "x.pdf", "composition", "auto")
    assert seen == ["auto"]                                   # без force


def test_extract_no_vision_fallback_when_payload_present(monkeypatch):
    """Намери ли състав детерминистично, не вика излишно AI-зрение."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    seen = []

    monkeypatch.setattr(engine, "extract_drafts",
                        lambda path, kind, ocr_mode, name: seen.append(ocr_mode) or
                        ([{"name": name, "composition": [{"inci_name": "Aqua", "pct": 100}]}], []))
    engine.extract_structured(b"%PDF", "x.pdf", "composition", "auto")
    assert seen == ["auto"]                                   # без излишен force


def test_extract_formula_kind_skips_vision_fallback(monkeypatch):
    """Рецепта (kind=formula) няма състав по дефиниция — без излишно AI-зрение."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    seen = []
    monkeypatch.setattr(engine, "extract_drafts",
                        lambda path, kind, ocr_mode, name: seen.append(ocr_mode) or
                        ([{"name": "Бадемово масло", "dose_pct": 69.5, "composition": []}], []))
    engine.extract_structured(b"\xff\xd8", "recipe.jpg", "formula", "auto")
    assert seen == ["auto"]                                   # без force за рецепта


def test_filter_drops_generic_table_headers():
    """Заглавия на колони като „Unit“/„Value“ не са INCI и отпадат (вместо да станат съставка)."""
    import copy
    rms = [{"name": "Argan", "composition": [
        {"inci_name": "Unit", "pct": 10},
        {"inci_name": "Value", "pct": 5},
        {"inci_name": "Argania Spinosa Kernel Oil", "pct": 100},
    ]}]
    kept, dropped = engine.filter_candidates(copy.deepcopy(rms))
    names = {c["inci_name"] for rm in kept for c in rm["composition"]}
    assert names == {"Argania Spinosa Kernel Oil"}
    assert dropped == 2


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


def test_extract_endpoint_returns_intake_summary(monkeypatch):
    rms = [{"name": "Sweet Almond Oil", "dose_pct": "TODO",
            "composition": [{"inci_name": "Prunus Amygdalus Dulcis Oil", "pct": 100}]}]
    monkeypatch.setattr(engine, "extract_structured", _fake_extract(rms, ["провери числата"]))
    r = client.post("/extract",
                    data={"type": "composition", "ocr": "never"},
                    files={"files": ("Almond Oil.pdf", b"%PDF-1.4 dummy", "application/pdf")})
    assert r.status_code == 200
    assert "Almond Oil.pdf" in r.text             # името на файла в прегледа
    assert "intake-doc" in r.text                 # единица за клиентско консолидиране
    assert "data-rms=" in r.text                  # структурирани данни за клиента
    assert "data-role=" in r.text                 # авто-разпозната роля
    assert 'role="ingredient"' in r.text or "role-ingredient" in r.text  # съставков документ
    assert "Prunus Amygdalus Dulcis Oil" in r.text  # реалната съставка (в data-rms)
    assert "провери числата" in r.text            # бележки от сканирането
    # старите ръчни контроли за мапване вече не съществуват
    assert "data-add-all" not in r.text
    assert 'class="di-dest"' not in r.text


def test_extract_classifies_fragrance_certificate(monkeypatch):
    """Документ с алергени се разпознава като аромат (роля fragrance)."""
    rms = [{"name": "Peace on Earth", "is_fragrance": True,
            "allergens": [{"name": "Limonene", "pct_in_fragrance": 4.0}]}]
    monkeypatch.setattr(engine, "extract_structured", _fake_extract(rms, []))
    r = client.post("/extract", data={"type": "auto", "ocr": "never"},
                    files={"files": ("Parfum_PEace on Earth.pdf", b"%PDF d", "application/pdf")})
    assert r.status_code == 200
    assert 'data-role="fragrance"' in r.text


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
