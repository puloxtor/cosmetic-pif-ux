"""
AI съпоставяне „документ → ред от рецептата“ (UX слой; ПРЕДЛОЖЕНИЕ, не енджин).

Рецептата може да е на български/търговски имена/шумен OCR, а документите идват на
английски с INCI — token-overlap не работи между езиците. Затова молим модела да
обвърже всеки документ към реда, който описва, ползвайки INCI-то В САМИЯ документ
плюс значението на името на реда. Изходът е ЧЕРНОВА — човекът потвърждава на гейта
(docs/UX_INTAKE_SPEC.md §0). INCI/числата идват от документа, не оттук; този слой
само избира КОЙ ред към КОЙ документ.

Иска пакета `anthropic` и ANTHROPIC_API_KEY (както AI-зрението). Без ключ/пакет или
при грешка връща {"available": False} — UX-ът пада обратно към простата евристика.
"""
from __future__ import annotations
import json
import os

# Лек, но способен модел е достатъчен за съпоставяне (само текст). Сменяем с env.
DEFAULT_MODEL = os.environ.get("PIF_MATCH_MODEL", "claude-haiku-4-5")

SYSTEM = (
    "You match cosmetic raw-material documents to the lines of a product formula. "
    "Each formula line is a raw-material name as written by the formulator — it may "
    "be in Bulgarian or another language, a trade name, or noisy OCR text. Each "
    "document lists the INCI names (and/or fragrance allergens) it certifies.\n"
    "For every document, decide which SINGLE formula line it describes, using: the "
    "INCI the document certifies vs the meaning of the line name (e.g. 'Бадемово "
    "масло' = almond oil = 'Prunus Amygdalus Dulcis Oil'; 'жожоба' = jojoba = "
    "'Simmondsia Chinensis Seed Oil'); trade names (e.g. 'Vegelight' = 'Coconut "
    "Alkanes'; the filename helps); a fragrance/allergen document matches the "
    "fragrance/parfum line. Output exactly one entry per document, with the 0-based "
    "'row' index it belongs to. If you are not confident a document belongs to any "
    "line, set matched=false. Never invent a match. 'confidence' is 0..1."
)

_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["matches"],
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["doc", "row", "matched", "confidence", "why"],
                "properties": {
                    "doc": {"type": "integer"},
                    "row": {"type": "integer"},
                    "matched": {"type": "boolean"},
                    "confidence": {"type": "number"},
                    "why": {"type": "string"},
                },
            },
        },
    },
}


def _call_model(rows: list, docs: list, model: str) -> dict:
    """Изолиран за тестване: вика Claude и връща суровия JSON dict по схемата."""
    import anthropic
    client = anthropic.Anthropic()  # чете ANTHROPIC_API_KEY от средата
    payload = json.dumps({"rows": rows, "docs": docs}, ensure_ascii=False)
    resp = client.messages.create(
        model=model,
        max_tokens=4000,
        temperature=0,                       # детерминизъм (човекът пак потвърждава)
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        messages=[{"role": "user", "content": [{"type": "text", "text": payload}]}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def _validate(raw: dict, n_rows: int, n_docs: int) -> list:
    """Изчиства изхода: валидни индекси, по един запис на документ, чисти типове."""
    out, seen = [], set()
    for m in (raw or {}).get("matches", []) or []:
        try:
            doc = int(m.get("doc"))
            row = int(m.get("row"))
        except (TypeError, ValueError):
            continue
        if doc < 0 or doc >= n_docs or doc in seen:
            continue
        seen.add(doc)
        matched = bool(m.get("matched")) and 0 <= row < n_rows
        try:
            conf = float(m.get("confidence"))
        except (TypeError, ValueError):
            conf = 0.0
        out.append({
            "doc": doc,
            "row": row if matched else -1,
            "matched": matched,
            "confidence": max(0.0, min(1.0, conf)),
            "why": str(m.get("why", "")),
        })
    return out


def match_documents(rows: list, docs: list, model: str | None = None) -> dict:
    """rows=[{i,name}], docs=[{j,filename,inci[],allergens[],role}] → mapping.

    Връща {"available": bool, "matches": [...], "model": str|None, "note"?: str}.
    Никога не хвърля: липсващ ключ/пакет/грешка → available=False (UX → евристика).
    """
    rows = rows or []
    docs = docs or []
    if not rows or not docs:
        return {"available": True, "matches": [], "model": None}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"available": False, "matches": [],
                "note": "Няма ANTHROPIC_API_KEY — AI съпоставянето е недостъпно."}
    mdl = model or DEFAULT_MODEL
    try:
        raw = _call_model(rows, docs, mdl)
    except Exception as e:  # мрежа/ключ/пакет/JSON — UX пада към евристика
        return {"available": False, "matches": [],
                "note": f"AI съпоставянето не успя: {e}"}
    return {"available": True, "matches": _validate(raw, len(rows), len(docs)), "model": mdl}
