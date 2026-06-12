"""G1: версионен предпазител срещу скрит дрейф на пина.

`app/engine.py` е единственият мост към енджина. Този тест внася ВСЕКИ символ,
който мостът ползва, от пинования енджин. Ако пинът сочи енджин, на който липсва
символ (стар/нов несъвместим SHA), билдът пада ШУМНО тук, вместо тих KeyError в
продукцията. Допълва Dependabot (G2): пинът се вдига само през зелен PR.
"""
from __future__ import annotations
import importlib

import pytest


def test_all_bridge_symbols_importable():
    # Точно символите, които app/engine.py внася от pif_engine.
    from pif_engine import (  # noqa: F401
        __version__, build_product, consolidated_concentrations, generate_inci,
        allergens_to_declare, calculate_allergens, generate_cpsr,
        product_is_safe, ComputeResult, REGULATORY_REFS,
        PifInputError, PifDataGapError,
    )
    from pif_engine.allergens import ALLERGEN_THRESHOLD  # noqa: F401
    from pif_engine.nomenclature import DECLARABLE_ALLERGENS  # noqa: F401
    from pif_engine.cpsr import check_documentation_gates  # noqa: F401
    from pif_engine.extraction.router import extract_drafts  # noqa: F401
    from pif_engine.extraction.draft import to_yaml  # noqa: F401


def test_compute_result_contract_present():
    """Типизираният контракт трябва да съществува и да има очакваните полета."""
    from pif_engine import ComputeResult
    required = set(ComputeResult.__required_keys__)
    assert {"name", "product_type", "warnings", "table", "total",
            "sum_ok", "inci", "declared", "allergens"} <= required


def test_engine_pin_resolves():
    """pif_engine трябва да е инсталируем/внасяем на закачения пин."""
    assert importlib.import_module("pif_engine")


def test_bridge_reexports_for_single_bridge_rule():
    """main.py взима тези през engine.* (правилото за единствен мост)."""
    from app import engine
    assert engine.DECLARABLE_ALLERGENS
    assert engine.REGULATORY_REFS
