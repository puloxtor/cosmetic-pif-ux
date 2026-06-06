"""
Тънък адаптер към pif_engine (инсталиран като ПИНОВАНА зависимост).

UX-ът НЕ дублира никаква енджин логика — само вика публичните функции.
Енджинът е единственият източник на истина; този слой е презентация + I/O.
"""
from __future__ import annotations
import os
import re
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
           "filter_candidates", "compute_from_yaml", "allergen_table",
           "friendly_error"]


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


# --- филтър на кандидати: не-INCI текст не бива да става съставка ---------
# Извличането (в pif_engine) понякога подава правни/таблични редове като
# „съставки“. Тук, на ГРАНИЦАТА на UX-а (не в енджина), ги отсяваме, преди да
# могат да се покажат/съхранят. Консервативно — извлеченото е само предложение.
_CI_RE = re.compile(r"^(ci|c\.i\.)\s*\d{4,6}$", re.IGNORECASE)
_NON_INCI_RE = re.compile(
    r"(ppm|reach|regul|\breg\.|annex|registration|exempt|country of origin|"
    r"origin\b|refined|see point|paragraph|declaration|status|1907/?2006|"
    r"ec\s*1907|einecs|directive|according to|manufacturer|supplier|address|"
    r"batch|specification|\blimit\b|σ|gmbh|stra(?:ss|ß)e|seite|\btel\b|\bfax\b|"
    r"e-?mail|www|säure|\bpage\b|\bvon\b)",
    re.IGNORECASE)


def _plausible_inci(name: str) -> bool:
    """Грубо: прилича ли низът на INCI име, а НЕ на правен/табличен/адресен текст.

    Маркери за изхвърляне: двоеточие (напр. фатти-acid „C20:1“ или „Origin:“),
    процент/запетая в самото име, дълги изречения, цели числа (адрес/страница/
    пощенски код), ключови думи (REACh, ppm, „Limit“, GmbH, Seite, säure…).
    """
    s = (name or "").strip()
    if not s:
        return False
    if _CI_RE.match(s):                       # „CI 77491“ е валиден Colour Index
        return True
    if len(s) > 60:
        return False
    if any(ch in s for ch in (":", "%", "@")) or ", " in s:
        return False
    if _NON_INCI_RE.search(s):
        return False
    if re.search(r"\d{4,}", s):               # пощенски код / „1907“ / ppm число
        return False
    if any(re.fullmatch(r"\d+", tok) for tok in s.split()):  # самостоятелно число → адрес/страница
        return False
    letters = sum(c.isalpha() for c in s)
    if letters < 3 or letters / len(s) < 0.5:  # предимно цифри/пунктуация
        return False
    if len(s.split()) > 6:                     # цели изречения не са INCI
        return False
    return True


def filter_candidates(rms: list[dict]) -> tuple[list[dict], int]:
    """Маха не-INCI кандидати от композициите. Връща (rms, брой_изхвърлени)."""
    dropped = 0
    for rm in rms or []:
        comp = rm.get("composition")
        if isinstance(comp, list) and comp:
            kept = [c for c in comp if _plausible_inci(c.get("inci_name", ""))]
            dropped += len(comp) - len(kept)
            rm["composition"] = kept
    return rms, dropped


def _has_payload(rms: list[dict]) -> bool:
    """Има ли извлеченото реален състав/алергени (а не само име без INCI)?"""
    for rm in rms or []:
        if rm.get("composition") or rm.get("allergens") or rm.get("is_fragrance"):
            return True
    return False


def _extract_and_filter(path: str, kind: str, ocr_mode: str, name: str):
    """Едно извличане през енджина + почистване на не-INCI боклука."""
    rms, notes = extract_drafts(path, kind=kind, ocr_mode=ocr_mode, name=name)
    rms, dropped = filter_candidates(rms)
    if dropped:
        notes.append(
            f"{name}: пропуснати {dropped} реда, които не приличат на INCI "
            "(правен/табличен/адресен текст). Провери дали не липсва реална съставка.")
    return rms, notes


def extract_structured(data: bytes, filename: str, kind: str, ocr_mode: str):
    """Качен документ → (raw_materials: list[dict], notes: list[str]).

    Връща структурираните чернови суровини, ПОЧИСТЕНИ от не-INCI боклук. Числата
    са ПРЕДЛОЖЕНИЕ — проверяват се от човек.

    Резервно AI-зрение: детерминистичното четене на PDF е чувствително към
    оформлението и често изважда текст, но не намира таблицата със състава. Ако не
    излезе нито състав, нито алергени (и има ключ), препрочитаме СЪЩИЯ документ с
    AI-зрение, за да се извлече INCI-то директно от документа.
    """
    suffix = os.path.splitext(filename)[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
        tf.write(data)
        path = tf.name
    name = os.path.splitext(os.path.basename(filename))[0]
    try:
        rms, notes = _extract_and_filter(path, kind, ocr_mode, name)
        # Рецептата (kind=formula) няма състав по дефиниция — резервното зрение е
        # само за съставкови/ароматни документи, където очакваме INCI/алергени.
        if (ocr_mode != "force" and kind != "formula" and not _has_payload(rms)
                and os.environ.get("ANTHROPIC_API_KEY")):
            try:
                rms2, notes2 = _extract_and_filter(path, kind, "force", name)
            except Exception:
                rms2, notes2 = None, None
            if rms2 and _has_payload(rms2):
                rms, notes = rms2, notes2 + [
                    f"{name}: детерминистичното четене не намери състав — "
                    "препрочетено с AI-зрение."]
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
