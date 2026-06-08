"""
FastAPI + HTMX UX за козметичния PIF/CPSR енджин.

Една сесия = един продукт. Попълваш формулата (суровини + дози), по желание
качваш документи (за да се извлече чернова композиция), и получаваш таблицата
с разбивката + генерирания INCI. Цялата сметка идва от енджина (pif_engine).
"""
from __future__ import annotations
import hashlib
import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import engine, intake, matching, canonical

BASE = Path(__file__).parent
app = FastAPI(title="Cosmetic PIF/CPSR UX")

# Валидиране на качените документи (UX/устойчивост — не е енджин логика).
MAX_FILES = 20
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB на файл
ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_CT = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))


def _asset_version() -> str:
    """Кратък хеш на статиката (app.js + style.css) → кеш-busting на ?v=…, за да не
    сервира деплоят стар JS/CSS (промяна в який и да е файл вдига версията)."""
    h = hashlib.sha1()
    for fn in ("app.js", "style.css"):
        try:
            h.update((BASE / "static" / fn).read_bytes())
        except OSError:
            pass
    return h.hexdigest()[:8]


def _git_commit() -> str:
    """Текущия git commit SHA (за Railway deployment tracking)."""
    railway_sha = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "")
    if railway_sha:
        return railway_sha[:7]
    git_dir = BASE.parent / ".git"
    if not git_dir.exists():
        return "unknown"
    try:
        head_file = git_dir / "HEAD"
        ref = head_file.read_text().strip()
        if ref.startswith("ref: "):
            ref_path = git_dir / ref[5:]
            return ref_path.read_text().strip()[:7]
        return ref[:7]
    except Exception:
        return "unknown"


def _engine_pin() -> str:
    """Извлича 7-знаковия SHA на закачения engine commit от requirements.txt."""
    import re
    try:
        req = (BASE.parent / "requirements.txt").read_text()
        m = re.search(r"@([0-9a-f]{7,40})", req)
        return m.group(1)[:7] if m else "?"
    except Exception:
        return "?"


ASSET_VERSION = _asset_version()
GIT_COMMIT = _git_commit()
ENGINE_PIN = _engine_pin()

from pif_engine.nomenclature import DECLARABLE_ALLERGENS as _DA
_ALLERGEN_COUNT = len(_DA)

_log = logging.getLogger(__name__)
_log.info(
    "PIF-UX startup | ux_commit=%s | engine_pin=%s | allergens=%s | assets=%s",
    GIT_COMMIT, ENGINE_PIN, _ALLERGEN_COUNT, ASSET_VERSION,
)

# Примерна формула, заредена по подразбиране (работи веднага при Compute).
SAMPLE_FORMULA = """product:
  name: "Demo Beard Oil"
  product_type: "leave-on"      # leave-on | rinse-off
  applied_amount_g: 2.0
  retention_factor: 1.0
  sale_countries: ["BG"]

raw_materials:
  - name: "Sweet Almond Oil"
    dose_pct: 96.5
    composition:
      - { inci_name: "Prunus Amygdalus Dulcis Oil", cas: "8007-69-0", pct: 100 }

  - name: "Parfum (пример)"
    dose_pct: 3.0
    is_fragrance: true
    allergens:
      - { name: "Limonene", cas: "5989-27-5", pct_in_fragrance: 4.0 }
      - { name: "Linalool", cas: "78-70-6", pct_in_fragrance: 1.5 }

  - name: "Tocopherol"
    dose_pct: 0.5
    composition:
      - { inci_name: "Tocopherol", cas: "59-02-9", pct: 100 }

claims:
  - "Подхранва брадата"
"""


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {
        "engine_version": engine.ENGINE_VERSION,
        "engine_pin": ENGINE_PIN,
        "asset_version": ASSET_VERSION,
        "git_commit": GIT_COMMIT,
    })


async def _process_one(f: UploadFile, type: str, ocr: str) -> dict:
    """Валидира и извлича ЕДИН файл → {filename, rms, notes, error, role}.

    Извиква се за всеки качен файл от /extract; грешка се връща в полето error,
    за да не събаря останалите файлове, нито UI-я. Ролята (рецепта / съставков
    документ / аромат) се определя автоматично — ползвателят не класифицира ръчно.
    """
    name = f.filename or "document"
    doc = {"filename": name, "rms": [], "notes": [], "error": None,
           "role": "ingredient"}
    try:
        ext = os.path.splitext(name)[1].lower()
        if ext not in ALLOWED_EXT:
            raise ValueError(
                f"Неподдържан тип файл „{ext or '?'}“. Разреши: PDF, PNG, JPG, WEBP.")
        if f.content_type and f.content_type not in ALLOWED_CT:
            raise ValueError(f"Неочакван тип съдържание „{f.content_type}“.")
        data = await f.read(MAX_FILE_BYTES + 1)  # ограничено четене
        if len(data) > MAX_FILE_BYTES:
            raise ValueError("Файлът е твърде голям (макс. 10 MB).")
        # Авто-роля → правилен kind за енджина (изричен избор от UI има предимство).
        kind = intake.kind_for_extraction(name, type)
        rms, notes = engine.extract_structured(data, name, kind, ocr)
        doc["rms"] = rms
        doc["notes"] = notes
        doc["role"] = intake.classify_document(name, rms)
    except Exception as e:  # извличането никога не бива да събаря UI-я
        doc["error"] = engine.friendly_error(e)
    return doc


@app.post("/extract", response_class=HTMLResponse)
async def extract(request: Request,
                  files: list[UploadFile] = File(...),
                  type: str = Form("auto"),
                  ocr: str = Form("auto")):
    """Един или няколко документа → чернови суровини за добавяне във формата.

    Всеки файл се обработва отделно: грешка в един не спира останалите.
    """
    if len(files) > MAX_FILES:
        return templates.TemplateResponse(request, "_draft.html", {"documents": [
            {"filename": f"{len(files)} файла", "rms": [], "notes": [],
             "error": f"Прекалено много файлове наведнъж (макс. {MAX_FILES})."}]})

    documents = [await _process_one(f, type, ocr) for f in files]
    return templates.TemplateResponse(request, "_draft.html", {
        "documents": documents,
    })


@app.post("/match")
async def match(request: Request):
    """Документи → ред от рецептата (AI ПРЕДЛОЖЕНИЕ; човек потвърждава на гейта).

    JSON вход {rows, docs} → JSON {available, matches, model, note?}. Никога не дава
    500: при липсващ ключ/грешка връща available=False, за да падне UX-ът към
    простата евристика. Самото съпоставяне е в app/matching.py.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    rows = payload.get("rows") or []
    docs = payload.get("docs") or []
    return matching.match_documents(rows, docs)


@app.post("/canonicalize")
async def canonicalize_route(request: Request):
    """INCI имена → канонични EU INCI (AI ПРЕДЛОЖЕНИЕ; човек потвърждава на гейта).

    JSON {items:[{id,name,kind,context}]} → {available, items, model, note?}. Никога
    не дава 500: при липсващ ключ/грешка → available=False, UX-ът ползва само регистър.
    Самото канонизиране е в app/canonical.py.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    items = payload.get("items") or []
    return canonical.canonicalize(items)


@app.get("/healthz")
def healthz():
    return {
        "engine_version": engine.ENGINE_VERSION,
        "engine_pin": ENGINE_PIN,
        "declarable_allergens": _ALLERGEN_COUNT,
        "ux_commit": GIT_COMMIT,
        "asset_version": ASSET_VERSION,
    }


@app.post("/compute", response_class=HTMLResponse)
def compute(request: Request, formula: str = Form(...), cpsr: str = Form(None)):
    try:
        result = engine.compute_from_yaml(formula, include_cpsr=bool(cpsr))
    except Exception as e:
        return templates.TemplateResponse(request, "_error.html",
                                          {"error": engine.friendly_error(e)})
    return templates.TemplateResponse(request, "_results.html", {"r": result})
