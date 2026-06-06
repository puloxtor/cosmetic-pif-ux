"""Авто-класификация на качени документи (UX слой; без мрежа).

Покрива примерния комплект „Beard Oil“ от docs/UX_INTAKE_SPEC.md §1:
една рецепта (снимка) + по един подкрепящ документ на суровина + аромат/IFRA.
"""
from app import intake


def test_photo_with_dosed_rows_is_formula():
    """Снимка на рецептата → редове „име + %“ без състав → рецепта."""
    rms = [{"name": "Almond oil", "dose_pct": 69.5},
           {"name": "Castor oil", "dose_pct": 20}]
    assert intake.classify_document("PXL_20260604_113448997.jpg", rms) == "formula"


def test_recipe_pdf_by_dosed_rows():
    rms = [{"name": "A", "dose_pct": 60}, {"name": "B", "dose_pct": 40}]
    assert intake.classify_document("anything.pdf", rms) == "formula"


def test_allergens_make_it_fragrance():
    rms = [{"name": "Parfum", "is_fragrance": True,
            "allergens": [{"name": "Limonene", "pct_in_fragrance": 4.0}]}]
    assert intake.classify_document("Parfum_PEace on Earth.pdf", rms) == "fragrance"


def test_fragrance_by_filename_even_without_rms():
    assert intake.classify_document("IFRA certificate.pdf", []) == "fragrance"


def test_single_inci_pdf_is_ingredient():
    rms = [{"name": "Almond Oil",
            "composition": [{"inci_name": "Prunus Amygdalus Dulcis Oil", "pct": 100}]}]
    assert intake.classify_document("Almond Oil.pdf", rms) == "ingredient"


def test_blend_pdf_is_ingredient():
    rms = [{"name": "Oleophen", "composition": [
        {"inci_name": "Helianthus Annuus Seed Oil", "pct": 50},
        {"inci_name": "Olea Europaea Fruit Oil", "pct": 50}]}]
    assert intake.classify_document("TDS OLEOPHEN COSMOS APPR..pdf", rms) == "ingredient"


def test_kind_for_extraction_routes_by_name_and_ext():
    assert intake.kind_for_extraction("Parfum_PEace.pdf") == "fragrance"
    assert intake.kind_for_extraction("recipe.png") == "formula"      # по име
    assert intake.kind_for_extraction("PXL_1234.jpg") == "formula"     # снимка → рецепта
    assert intake.kind_for_extraction("Almond Oil.pdf") == "composition"


def test_explicit_type_overrides_auto():
    assert intake.kind_for_extraction("PXL_1234.jpg", "composition") == "composition"
    assert intake.kind_for_extraction("Almond Oil.pdf", "fragrance") == "fragrance"


def test_todo_dose_is_not_a_real_dose():
    """Подкрепящ документ връща dose_pct='TODO' — не бива да мине за рецепта."""
    rms = [{"name": "X", "dose_pct": "TODO",
            "composition": [{"inci_name": "Aqua", "pct": 100}]}]
    assert intake.classify_document("spec.pdf", rms) == "ingredient"
