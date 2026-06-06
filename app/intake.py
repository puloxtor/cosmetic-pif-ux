"""Роля на качен документ (UX слой — НЕ енджин логика).

Енджинът (`pif_engine`) чете ЕДИН файл наведнъж и не разпознава каква е ролята му.
Тук, на границата на UX-а, решаваме без ползвателят да класифицира ръчно: кой
файл е РЕЦЕПТАТА (дава име + доза на всяка суровина) и кои са ПОДКРЕПЯЩИ документи
(дават INCI/състав, а ароматните — алергени). Това е само евристика за маршрут;
всички числа продължават да идват от енджина.

Виж docs/UX_INTAKE_SPEC.md §2 (Classify documents).
"""
from __future__ import annotations
import os
import re

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

# Името/първите редове подсказват аромат (IFRA/алергенна справка) …
_FRAG_RE = re.compile(r"parfum|parf[üu]m|fragrance|aroma|ifra|allerg", re.IGNORECASE)
# … или рецепта (списък „име + %“).
_FORMULA_RE = re.compile(r"recipe|formula|рецепт|формул", re.IGNORECASE)


def _has_real_dose(rm: dict) -> bool:
    """Има ли суровината реална доза (а не подразбиращото се „TODO“)?"""
    d = rm.get("dose_pct")
    if d is None:
        return False
    s = str(d).strip().lower()
    if not s or s == "todo":
        return False
    try:
        return float(d) > 0
    except (TypeError, ValueError):
        return False


def kind_for_extraction(filename: str, requested: str = "auto") -> str:
    """Избира `kind` за extract_drafts на ЕДИН файл, ПРЕДИ да го прочетем.

    Ползвателят пуска цялата папка с „Автоматично“; тук подаваме на енджина
    най-вероятния вид по име/разширение, за да чете правилно. Изрично избран
    вид от UI-я има предимство.
    """
    if requested and requested != "auto":
        return requested
    name = (filename or "").lower()
    if _FRAG_RE.search(name):
        return "fragrance"
    if _FORMULA_RE.search(name):
        return "formula"
    if os.path.splitext(name)[1] in IMAGE_EXTS:
        return "formula"      # снимка → най-често ръкописната/печатна рецепта
    return "composition"


def classify_document(filename: str, rms: list | None) -> str:
    """Роля на вече прочетен документ: ``formula`` | ``fragrance`` | ``ingredient``.

    Решава предимно по СЪДЪРЖАНИЕ (по-сигурно от името):
      - извлечени алергени / аромат → ``fragrance``;
      - няколко реда с реална доза и без състав → ``formula`` (рецептата);
      - иначе → ``ingredient`` (подкрепящ съставков документ).
    """
    rms = rms or []
    name = (filename or "").lower()

    if any(rm.get("is_fragrance") or rm.get("allergens") for rm in rms):
        return "fragrance"
    if _FRAG_RE.search(name):
        return "fragrance"

    dosed_no_comp = [rm for rm in rms if _has_real_dose(rm) and not rm.get("composition")]
    if len(dosed_no_comp) >= 2:
        return "formula"
    if _FORMULA_RE.search(name):
        return "formula"
    if (os.path.splitext(name)[1] in IMAGE_EXTS
            and not any(rm.get("composition") for rm in rms)):
        return "formula"      # снимка без разпознат състав → най-вероятно рецепта

    return "ingredient"


def role_label(role: str) -> str:
    """Кратко човешко описание на ролята (за прегледа на качването)."""
    return {
        "formula": "рецепта",
        "fragrance": "аромат · алергени",
        "ingredient": "съставков документ",
    }.get(role, "съставков документ")
