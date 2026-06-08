"""
AI канонизиране на INCI имена (UX слой; ПРЕДЛОЖЕНИЕ, не енджин).

Имената идват дословно от документите — различен регистър, търговски/обикновени
имена (Sunflower Oil вместо Helianthus Annuus Seed Oil; Mixed tocopherols вместо
Tocopherol), а ароматните сертификати често връщат и НЕ-алергени. Тук молим модела
да приведе всяко име към официалното EU INCI и да маркира кои ароматни вещества са
наистина декларируеми алергени (Анекс III). Резултатът е ЧЕРНОВА — човекът
потвърждава на гейта; енджинът прави праговете и подреждането.

Иска `anthropic` + ANTHROPIC_API_KEY (както AI-зрението/съпоставянето). Без ключ
или при грешка връща {"available": False} — UX-ът ползва само детерминистичния
регистър (inciCase в app.js).
"""
from __future__ import annotations
import json
import os

from .matching import _models_to_try   # обща верига от потвърдени модели

DEFAULT_MODEL = (os.environ.get("PIF_CANON_MODEL")
                 or os.environ.get("PIF_VISION_MODEL", "claude-opus-4-8"))

SYSTEM = (
    "You normalize cosmetic ingredient names to their official EU INCI form for an "
    "Art. 19 label. Rules:\n"
    "- 'canonical' = the official INCI name with standard INCI capitalization. Map "
    "common/trade names to INCI (e.g. 'Sunflower Oil' -> 'Helianthus Annuus Seed "
    "Oil'; 'Mixed tocopherols' -> 'Tocopherol'; 'Vitamin E' -> 'Tocopherol'). Keep "
    "Colour Index codes like 'CI 77491'. Do not translate to another language; do "
    "not invent substances.\n"
    "- For kind='allergen' (substances from a fragrance): set declarable=true ONLY "
    "if it is a regulated Annex III declarable fragrance allergen (e.g. Limonene, "
    "Linalool, Citronellol, Geraniol, Citral, Eugenol, Isoeugenol, Coumarin, "
    "Benzyl Alcohol, Benzyl Salicylate, Benzyl Benzoate, Hexyl Cinnamal, "
    "Hydroxycitronellal, alpha-Isomethyl Ionone, Farnesol, Cinnamal, Cinnamyl "
    "Alcohol, Amyl Cinnamal, Eugenyl... ). Set declarable=false for general aroma "
    "chemicals / solvents / antioxidants / essential oils NOT on that list (e.g. "
    "Iso E Super = Tetramethyl Acetyloctahydronaphthalenes, Pinene, "
    "Beta-Caryophyllene, Linalyl Acetate, Geranyl Acetate, BHT/Butylated "
    "Hydroxytoluene, Citrus/Pogostemon oils) — those are part of 'Parfum'.\n"
    "- set drop=true only if the text is not an ingredient at all (a header/number).\n"
    "Return exactly one entry per input id; keep the same ids."
)

_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["id", "canonical", "declarable", "drop"],
                "properties": {
                    "id": {"type": "integer"},
                    "canonical": {"type": "string"},
                    "declarable": {"type": "boolean"},
                    "drop": {"type": "boolean"},
                },
            },
        },
    },
}


def _call_model(items: list, model: str) -> dict:
    """Изолиран за тестване: вика Claude и връща суровия JSON dict по схемата."""
    import anthropic
    client = anthropic.Anthropic()  # чете ANTHROPIC_API_KEY от средата
    payload = json.dumps({"items": items}, ensure_ascii=False)
    resp = client.messages.create(
        model=model,
        max_tokens=4000,
        temperature=0,
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        messages=[{"role": "user", "content": [{"type": "text", "text": payload}]}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def _validate(raw: dict, n: int) -> list:
    out, seen = [], set()
    for it in (raw or {}).get("items", []) or []:
        try:
            i = int(it.get("id"))
        except (TypeError, ValueError):
            continue
        if i < 0 or i >= n or i in seen:
            continue
        seen.add(i)
        out.append({
            "id": i,
            "canonical": str(it.get("canonical", "") or "").strip(),
            "declarable": bool(it.get("declarable")),
            "drop": bool(it.get("drop")),
        })
    return out


def canonicalize(items: list, model: str | None = None) -> dict:
    """items=[{id,name,kind,context}] → {available, items:[{id,canonical,declarable,drop}], model}.

    Никога не хвърля: липсващ ключ/пакет/грешка → available=False (UX → само регистър).
    """
    items = items or []
    if not items:
        return {"available": True, "items": [], "model": None}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"available": False, "items": [],
                "note": "Няма ANTHROPIC_API_KEY — AI нормализацията е недостъпна."}
    errors = []
    for mdl in _models_to_try(model or DEFAULT_MODEL):
        try:
            raw = _call_model(items, mdl)
        except Exception as e:
            errors.append(f"{mdl}: {e}")
            continue
        return {"available": True, "items": _validate(raw, len(items)), "model": mdl}
    return {"available": False, "items": [],
            "note": "AI нормализацията не успя: " + " | ".join(errors)}
