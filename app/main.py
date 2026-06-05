"""
FastAPI + HTMX UX за козметичния PIF/CPSR енджин.

Една сесия = един продукт. Попълваш формулата (суровини + дози), по желание
качваш документи (за да се извлече чернова композиция), и получаваш таблицата
с разбивката + генерирания INCI. Цялата сметка идва от енджина (pif_engine).
"""
from __future__ import annotations
from pathlib import Path

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import engine

BASE = Path(__file__).parent
app = FastAPI(title="Cosmetic PIF/CPSR UX")
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))

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
        "sample": SAMPLE_FORMULA,
    })


@app.post("/extract", response_class=HTMLResponse)
async def extract(request: Request,
                  files: list[UploadFile] = File(...),
                  type: str = Form("auto"),
                  ocr: str = Form("auto")):
    """Един или няколко документа → чернови суровини за добавяне във формата.

    Всеки файл се обработва отделно: грешка в един не спира останалите.
    """
    documents = []
    for f in files:
        name = f.filename or "document"
        doc = {"filename": name, "rms": [], "notes": [], "error": None}
        try:
            data = await f.read()
            rms, notes = engine.extract_structured(data, name, type, ocr)
            doc["rms"] = rms
            doc["notes"] = notes
        except Exception as e:  # извличането никога не бива да събаря UI-я
            doc["error"] = engine.friendly_error(e)
        documents.append(doc)
    return templates.TemplateResponse(request, "_draft.html", {
        "documents": documents,
    })


@app.post("/compute", response_class=HTMLResponse)
def compute(request: Request, formula: str = Form(...), cpsr: str = Form(None)):
    try:
        result = engine.compute_from_yaml(formula, include_cpsr=bool(cpsr))
    except Exception as e:
        return templates.TemplateResponse(request, "_error.html",
                                          {"error": engine.friendly_error(e)})
    return templates.TemplateResponse(request, "_results.html", {"r": result})
