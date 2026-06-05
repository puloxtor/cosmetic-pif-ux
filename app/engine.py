"""
Тънък адаптер към pif_engine (инсталиран като ПИНОВАНА зависимост).

UX-ът НЕ дублира никаква енджин логика — само вика публичните функции.
Енджинът е единственият източник на истина; този слой е презентация + I/O.
"""
from __future__ import annotations
import os
import tempfile

import yaml

from pif_engine import (
    __version__ as ENGINE_VERSION,
    build_product, consolidated_concentrations, generate_inci,
    allergens_to_declare, calculate_allergens, generate_cpsr,
)
from pif_engine.allergens import ALLERGEN_THRESHOLD
from pif_engine.extraction.router import extract_drafts
from pif_engine.extraction.draft import to_yaml

__all__ = ["ENGINE_VERSION", "extract_document", "extract_structured",
           "compute_from_yaml", "allergen_table", "friendly_error"]


def friendly_error(exc: Exception) -> str:
    """Сурова грешка → разбираемо съобщение на човешки език.

    Не крие проблема — обяснява причината и какво да се направи. Числата и
    логиката идват само от енджина; тук само превеждаме съобщенията.
    """
    text = str(exc)

    # AI-зрението без ключ (най-честият случай при качване на снимка).
    if ("authentication" in text.lower() or "api_key" in text.lower()
            or "ANTHROPIC_API_KEY" in text):
        return ("AI разчитането на снимки/сканирани документи иска ключ "
                "(ANTHROPIC_API_KEY). Качи цифров PDF или въведи съставките "
                "ръчно във формата.")

    # Грешка в YAML структурата — посочи реда, ако го има.
    if isinstance(exc, yaml.YAMLError):
        mark = getattr(exc, "problem_mark", None)
        if mark is not None:
            return (f"Има грешка в структурата на формулата (ред {mark.line + 1}). "
                    "Провери дали отстъпите и двоеточията са правилни.")
        return ("Има грешка в структурата на формулата. Провери дали отстъпите "
                "и двоеточията са правилни.")

    # Липсващи задължителни полета.
    if isinstance(exc, KeyError):
        missing = text.strip("'\"")
        return (f"Липсва задължително поле „{missing}“. Всеки продукт има име, "
                "тип и поне една съставка.")

    # Резервен вариант — пак показваме съобщението, но подканяме за проверка.
    return text


def extract_structured(data: bytes, filename: str, kind: str, ocr_mode: str):
    """Качен документ → (raw_materials: list[dict], notes: list[str]).

    Връща структурираните чернови суровини точно както енджинът ги дава, за да
    могат да станат редове във формата с едно кликане. Числата са ПРЕДЛОЖЕНИЕ —
    проверяват се от човек.
    """
    suffix = os.path.splitext(filename)[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
        tf.write(data)
        path = tf.name
    try:
        name = os.path.splitext(os.path.basename(filename))[0]
        rms, notes = extract_drafts(path, kind=kind, ocr_mode=ocr_mode, name=name)
    finally:
        os.unlink(path)
    return rms, notes


def extract_document(data: bytes, filename: str, kind: str, ocr_mode: str) -> str:
    """Качен документ → ЧЕРНОВА YAML фрагмент (за разширения режим)."""
    rms, notes = extract_structured(data, filename, kind, ocr_mode)
    return to_yaml(rms, notes=notes)


def allergen_table(product) -> list[dict]:
    """Прозрачна таблица на алергенната преценка — БЕЗ собствена математика.

    Оркестрира публичните енджин функции (calculate_allergens,
    allergens_to_declare, ALLERGEN_THRESHOLD) и за всеки алерген връща:
    {name, cas, conc_pct (в продукта), threshold_pct, declared}.
    Подредени по концентрация (низходящо), за да се вижда ЗАЩО даден алерген
    влиза или не влиза в INCI.
    """
    totals = calculate_allergens(product)            # {name: conc_% в продукта}
    declared = set(allergens_to_declare(product))    # имена над прага
    threshold = ALLERGEN_THRESHOLD[product.product_type]

    # CAS не идва от calculate_allergens — взимаме го от суровините.
    cas_by_name: dict[str, str] = {}
    for line in product.formula:
        for a in line.ingredient.allergens:
            cas_by_name.setdefault(a.name, a.cas)

    rows = [
        {
            "name": name,
            "cas": cas_by_name.get(name, ""),
            "conc_pct": conc,
            "threshold_pct": threshold,
            "declared": name in declared,
        }
        for name, conc in totals.items()
    ]
    rows.sort(key=lambda r: r["conc_pct"], reverse=True)
    return rows


def compute_from_yaml(yaml_text: str, include_cpsr: bool = False) -> dict:
    """Продуктов YAML → таблица + INCI + алергени + аларми (детерминистично)."""
    doc = yaml.safe_load(yaml_text)
    product, warnings = build_product(doc)
    totals = consolidated_concentrations(product)
    table = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    total = sum(totals.values())
    result = {
        "name": product.name,
        "product_type": product.product_type.value,
        "warnings": warnings,
        "table": [{"inci": k, "pct": v} for k, v in table],
        "total": total,
        "sum_ok": abs(total - 100.0) <= 0.5,
        "inci": generate_inci(product),
        "declared": allergens_to_declare(product),
        "allergens": allergen_table(product),
    }
    if include_cpsr:
        result["cpsr"] = generate_cpsr(product)
    return result
