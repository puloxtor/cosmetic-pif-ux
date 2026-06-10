# Engine handoff — INCI nomenclature (naming · Annex III · country)

> **How to use this:** open a **new Claude Code session on `puloxtor/cosmetic-pif-poc`**
> (so it can push to the engine), and paste everything from the `===== PROMPT
> START =====` line to the end as your first message. When it finishes it will
> give you a commit SHA + branch; bring that back to the `cosmetic-pif-ux` session
> and say e.g. "engine pushed, SHA = …" and I'll bump the pin + finish the UX side.

---

===== PROMPT START =====

You are working in the `puloxtor/cosmetic-pif-poc` repo (the deterministic
cosmetic PIF/CPSR engine, package `pif_engine`). Implement an **INCI
nomenclature layer** so the engine cleans the names it's given — the web UX
(`cosmetic-pif-ux`) feeds it data extracted from documents, which is often messy
(mixed case, common/trade names, fragrance certs that over-list non-allergens).
The engine must turn that into a clean, EU-compliant INCI list **deterministically**
(no LLM — CLAUDE.md). It already does Art. 19 ordering, duplicate-merge, and
allergen thresholds; you're adding the name/allergen cleaning next to that.

## Setup
```
git fetch origin
git checkout -b claude/epic-mccarthy-nW68A e3273e91805537d11c09a69410dc178890c4c461
```
(Branch off the **pinned commit `e3273e9`** — NOT `master`, which lacks the
`extraction/`, `composition.py`, `loader.py` modules the UX depends on.)

## 1. New file: `pif_engine/nomenclature.py`
```python
"""
INCI номенклатура (детерминистична, регулаторна) — Слой 1.

Привежда имената на съставките към официалния EU INCI вид и определя кои ароматни
вещества са ДЕКЛАРИРУЕМИ алергени (Анекс III, Регламент (ЕО) 1223/2009). Това е
детерминистичен код, не LLM (CLAUDE.md). Справочните таблици (синоними, алергени)
са РЕДАКТИРУЕМИ данни — поддържай ги спрямо актуалния закон.
"""
from __future__ import annotations
import re

# Абревиатури, които остават с главни букви в INCI.
_UPPER = {"peg", "ppg", "pvp", "pvm", "vp", "va", "sd", "mea", "dea", "tea",
          "edta", "bht", "bha", "tbhq", "pca", "ci", "pg", "ahas"}
_CI_RE = re.compile(r"^ci\s*\d{4,6}$", re.IGNORECASE)
# Гръцки/позиционни представки, които остават с малки букви в INCI.
_LOWER_PREFIX = {"alpha", "beta", "gamma", "delta", "cis", "trans",
                 "ortho", "meta", "para", "sec", "tert", "dl", "d", "l", "n"}


def _cap(w: str) -> str:
    return w[:1].upper() + w[1:].lower() if w else w


def _title_token(tok: str) -> str:
    low = tok.lower()
    if low in _UPPER:
        return tok.upper()
    m = re.match(r"^([a-z]+)-(\d+[a-z]?)$", tok, re.IGNORECASE)   # PEG-40, Steareth-2
    if m:
        head = m.group(1)
        head = head.upper() if head.lower() in _UPPER else _cap(head)
        return f"{head}-{m.group(2)}"
    if "-" in tok:
        parts = tok.split("-")
        out = []
        for i, p in enumerate(parts):
            out.append(p.lower() if i == 0 and p.lower() in _LOWER_PREFIX
                       else _title_token(p))
        return "-".join(out)
    if any(ch.isdigit() for ch in tok):
        return tok                                  # „77491“, числа → както са
    return _cap(tok)


def _to_title(name: str) -> str:
    s = re.sub(r"\s+", " ", (name or "").strip())
    if not s:
        return s
    if _CI_RE.match(s):
        return "CI " + re.sub(r"\D", "", s)
    return " ".join(_title_token(t) for t in s.split(" "))


def _key(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


# Обикновени/търговски/чуждоезични имена → официално INCI. РАЗШИРЯВАЙ при нужда.
# (Само ГЕНЕРИЧНИ имена — доставчикови търговски имена идват от документа/UX AI.)
_SYNONYMS = {
    "water": "Aqua", "eau": "Aqua",
    "sunflower oil": "Helianthus Annuus Seed Oil",
    "sunflower seed oil": "Helianthus Annuus Seed Oil",
    "almond oil": "Prunus Amygdalus Dulcis Oil",
    "sweet almond oil": "Prunus Amygdalus Dulcis Oil",
    "castor oil": "Ricinus Communis Seed Oil",
    "argan oil": "Argania Spinosa Kernel Oil",
    "jojoba oil": "Simmondsia Chinensis Seed Oil",
    "olive oil": "Olea Europaea Fruit Oil",
    "mixed tocopherols": "Tocopherol", "tocopherols": "Tocopherol",
    "vitamin e": "Tocopherol",
    "butylhydroxytoluol": "BHT", "butylated hydroxytoluene": "BHT",
    "fragrance": "Parfum", "parfum/aroma": "Parfum",
}


def canonical_inci(name: str) -> str:
    """Официално INCI име: синоним → INCI; иначе единен регистър (Title Case)."""
    k = _key(name)
    if not k:
        return ""
    return _SYNONYMS.get(k) or _to_title(name)


# --- Анекс III: декларируеми ароматни алергени (нормализиран ключ → точно име) ---
# Класическите 26. ⚠️ Регламент (ЕС) 2023/1545 РАЗШИРИ списъка (~80, задължителен
# за нови продукти от 07/2026). Тук по подразбиране са 26-те — добави разширението
# в _DECLARABLE_EXTRA СЛЕД правна проверка от квалифициран оценител.
_DECLARABLE_26 = {
    "amyl cinnamal": "Amyl Cinnamal",
    "amylcinnamyl alcohol": "Amylcinnamyl Alcohol",
    "anise alcohol": "Anise Alcohol",
    "benzyl alcohol": "Benzyl Alcohol",
    "benzyl benzoate": "Benzyl Benzoate",
    "benzyl cinnamate": "Benzyl Cinnamate",
    "benzyl salicylate": "Benzyl Salicylate",
    "cinnamal": "Cinnamal",
    "cinnamyl alcohol": "Cinnamyl Alcohol",
    "citral": "Citral",
    "citronellol": "Citronellol",
    "coumarin": "Coumarin",
    "eugenol": "Eugenol",
    "farnesol": "Farnesol",
    "geraniol": "Geraniol",
    "hexyl cinnamal": "Hexyl Cinnamal",
    "hydroxycitronellal": "Hydroxycitronellal",
    "isoeugenol": "Isoeugenol",
    "limonene": "Limonene",
    "linalool": "Linalool",
    "methyl 2-octynoate": "Methyl 2-Octynoate",
    "alpha-isomethyl ionone": "alpha-Isomethyl Ionone",
    "butylphenyl methylpropional": "Butylphenyl Methylpropional",
    "evernia prunastri extract": "Evernia Prunastri Extract",
    "evernia furfuracea extract": "Evernia Furfuracea Extract",
    "hydroxyisohexyl 3-cyclohexene carboxaldehyde":
        "Hydroxyisohexyl 3-Cyclohexene Carboxaldehyde",
}
_DECLARABLE_EXTRA: dict[str, str] = {}   # 2023/1545 разширение — попълни след проверка
DECLARABLE_ALLERGENS = {**_DECLARABLE_26, **_DECLARABLE_EXTRA}


def declarable_name(name: str) -> str | None:
    """Точното INCI име на алергена, ако е деклариуем (Анекс III); иначе None."""
    return (DECLARABLE_ALLERGENS.get(_key(canonical_inci(name)))
            or DECLARABLE_ALLERGENS.get(_key(name)))


def is_declarable(name: str) -> bool:
    return declarable_name(name) is not None


# --- локализация по пазар (по избор) ---
_EU = {"", "EU", "BG", "DE", "FR", "IT", "ES", "NL", "PL", "RO", "GR", "AT",
       "BE", "CZ", "DK", "EE", "FI", "HR", "HU", "IE", "LT", "LU", "LV", "MT",
       "PT", "SE", "SI", "SK", "CY"}
_US_MAP = {"Aqua": "Water", "Parfum": "Fragrance", "Aroma": "Flavor"}


def localize_inci(name: str, countries: list[str] | None) -> str:
    """EU/по подразбиране: непроменено. Само извън-ЕС пазари (напр. US): US имена."""
    cs = [c.strip().upper() for c in (countries or []) if c.strip()]
    if cs and all(c not in _EU for c in cs):
        return _US_MAP.get(name, name)
    return name


# --- проверка (lint) за прегледа в UX ---
_NON_INCI = re.compile(r"(ppm|reach|annex|registration|\blimit\b|gmbh|\bpage\b)",
                       re.IGNORECASE)


def validate_inci(names: list[str]) -> list[str]:
    issues, seen = [], set()
    for n in names:
        k = _key(n)
        if k in seen:
            issues.append(f"Дубликат INCI: „{n}“.")
        seen.add(k)
        if len(n) > 60 or _NON_INCI.search(n) or "%" in n or ":" in n:
            issues.append(f"Съмнително INCI име: „{n}“ — провери спрямо CosIng.")
    return issues
```

## 2. Edit `pif_engine/composition.py` (`expand_raw_material`)
- Import at top: `from .nomenclature import canonical_inci, declarable_name`.
- **Fragrance branch** — canonicalize allergen names and **drop non-Annex-III**
  substances (they're part of `Parfum`, not separately declared):
  ```python
  allergens = []
  for a in rm.get("allergens", []):
      dn = declarable_name(a["name"])
      if dn is None:
          warnings.append(
              f"ℹ️ {name}: „{a['name']}“ не е деклариуем алерген (Анекс III) — част от Parfum.")
          continue
      allergens.append(AllergenContent(
          name=dn, cas=a.get("cas", "-"),
          fraction=float(a["pct_in_fragrance"]) / 100.0))
  ```
- **Ordinary/constituent branch** — canonicalize each INCI:
  ```python
  ing = Ingredient(
      inci_name=canonical_inci(c["inci_name"]),
      ...
  ```
  (Also `inci_name=canonical_inci(rm.get("inci_name", "Parfum"))` on the fragrance
  `Ingredient`.)

## 3. Edit `pif_engine/allergens.py` (`generate_inci`)
- Import: `from .nomenclature import localize_inci`.
- **Fix allergen placement (confirmed live):** today the declared allergens are
  spliced in immediately after the `Parfum` line. When ingredients ≥1% come AFTER
  Parfum (real case: Parfum 3% → Tocopherol 2.1% → Helianthus 1.175% → Simmondsia
  1.0%), the sub-1% allergens land BEFORE ≥1% ingredients — violating Art.
  19(1)(g) (everything <1% must follow everything >1%). Change the logic: build
  the list, then insert `allergens_to_declare(product)` at the position **after
  BOTH (a) the last ingredient ≥1% and (b) the Parfum/Aroma line** — i.e. at the
  head of the <1% block, or right after Parfum if Parfum itself is <1%. Keep the
  existing fallback (no Parfum line → append at the end, deduped).
- At the end, localize the final list per market before returning:
  ```python
  return [localize_inci(n, product.sale_countries) for n in inci]
  ```
  (Names are already canonical from ingestion; `allergens_to_declare` now only sees
  declarable, canonical names so it needs no change — but verify.)

## 4. Export from `pif_engine/__init__.py`
Add `canonical_inci, is_declarable, declarable_name, localize_inci, validate_inci,
DECLARABLE_ALLERGENS` to the imports/`__all__`.

## 5. Tests: `tests/test_nomenclature.py`
Cover: `canonical_inci("HELIANTHUS ANNUUS SEED OIL")=="Helianthus Annuus Seed Oil"`,
`canonical_inci("Argania spinosa kernel oil")=="Argania Spinosa Kernel Oil"`,
`canonical_inci("Sunflower Oil")=="Helianthus Annuus Seed Oil"`,
`canonical_inci("Mixed tocopherols")=="Tocopherol"`,
`canonical_inci("Butylhydroxytoluol")=="BHT"`, `canonical_inci("CI 77491")=="CI 77491"`;
`is_declarable("Limonene") is True`, `is_declarable("Iso E Super") is False`,
`is_declarable("Tetramethyl Acetyloctahydronaphthalenes") is False`,
`is_declarable("Pinene") is False`; `localize_inci("Aqua", ["US"])=="Water"`,
`localize_inci("Aqua", ["BG"])=="Aqua"`. Also a `build_product`→`generate_inci`
round-trip on a fragrance whose allergens include junk → only declarable names
survive, names canonical & deduped. **Placement test:** product with Parfum 3% and
a 2% + 1% ingredient after it → the declared allergens must appear AFTER the 1%
ingredient (head of the <1% block), not directly after Parfum; and with Parfum at
0.5% → allergens directly after Parfum is fine.

## 6. Run + push
```
python -m pytest -q          # fix any existing tests that assumed unfiltered allergens
git add -A && git commit -m "Add INCI nomenclature: canonical names, Annex III filter, country naming"
git push -u origin claude/epic-mccarthy-nW68A
```
Then **report back: the pushed commit SHA and branch name.**

## Caveats to tell the user
- The allergen list defaults to the **classic 26**; the **2023/1545** expansion
  (mandatory for new products from 07/2026) must be added to `_DECLARABLE_EXTRA`
  after a qualified assessor verifies it. With only the 26, substances like
  Geranyl/Linalyl Acetate, Amyl Salicylate, β-Caryophyllene, Iso E Super, Pinene
  are treated as part of `Parfum` (not declared) — matches the "clean" target list.
- Synonyms cover generic/common names only; supplier trade names still come from
  the document's stated INCI or the UX's AI proposal.

===== PROMPT END =====
