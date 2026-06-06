# UX Intake Spec — "Upload a set → get the table + INCI"

> **Audience:** the `cosmetic-pif-ux` repo (web front-end).
> **Purpose:** specify the exact process the UI must recreate so that a user
> uploads a *set of files* (one formula + the supporting documents for each
> ingredient) and gets back a correctly formatted composition table and an
> Art. 19 INCI list — the same result the engine already produces in the
> terminal for the MANE Shampoo test.
>
> This is a **build target**, not engine code. It pins down the input
> contract, the extraction targets, the non-negotiable human-verification
> gate, and the engine outputs, so the UI and the engine can be built
> against the same boundary.

---

## 0. The one rule that shapes the whole UI

From `CLAUDE.md`: **the calculation engine (allergens, MoS, INCI, claims) is
deterministic code, never an LLM. The LLM may only *suggest*.** Numbers from
an LLM never enter a dossier without a human approving them.

Consequence for the UI: there are **two distinct phases**, and a hard gate
between them:

```
  UPLOAD  →  EXTRACT (LLM, suggestion)  →  ┃ HUMAN VERIFY ┃  →  ENGINE (deterministic)  →  RENDER
                                           ┗━ the gate ━━┛
```

Everything left of the gate is editable, low-trust, "we think this says…".
Everything right of the gate is computed and reproducible. The UI must make
this boundary visually obvious and must not let unverified extraction flow
into the engine.

---

## 1. What a "set" is (worked example: Beard Oil)

A set = **exactly one formula** + **one supporting document per raw material**
(plus an IFRA/allergen certificate for any fragrance). The real example set
(`Ingredients` folder in Drive) is the Beard Oil product:

**Formula** (a single photo — handwritten or printed):
| Raw material (as written) | % |
|---|---|
| Almond oil | 69.5 |
| Castor oil | 20 |
| Oleophen / Vegelight | 3 |
| Argan oil | 3 |
| Jojoba oil | 1 |
| Tocopherol | 0.5 |
| "Peace on Earth" fragrance #211878 | 3 |

**Supporting docs** (resolve trade names → INCI/CAS, establish function & allergens):
| Document | Establishes | Doc type |
|---|---|---|
| Almond Oil.pdf | Prunus Amygdalus Dulcis Oil · 8007-69-0 | reg. info |
| Manufacturing-Flow…Castor.pdf | Ricinus Communis Seed Oil (100%) · 8001-79-4 | INCI statement |
| floviva Argan Oil…SDS.pdf | Argania Spinosa Kernel Oil (100%) · 223747-87-3 | SDS |
| AOT-SPEC_Jojoba.PDF | Simmondsia Chinensis Seed Oil (100%) · 90045-98-0 | spec |
| SDS Vitapherole T-70.pdf | Tocopherol (70%) + Sunflower oil | SDS |
| TDS OLEOPHEN COSMOS.pdf | Helianthus Annuus / Olea Europaea / Cucurbita Pepo / Hippophae Rhamnoides / Tocopherol (a *blend*) | TDS |
| Biosynthis_Vegelight_Silk.pdf | Coconut Alkanes (100%) | composition |
| **Parfum_PEace on Earth.pdf** | IFRA safety eval + **allergen table** (Limonene 4.0%, Linalool 1.565%, Coumarin 0.588%, Citral 0.213%, Eugenol 0.048%, Geraniol, Citronellol, Isoeugenol… at 1.5% assessment conc.) | IFRA cert |

### Reconciliations the human must resolve (design the gate around these)
These are real mismatches in the example set — the UI must surface them, not hide them:
- Formula says **"Vegelight Glu"**, the document present is **"Vegelight *Silk*"** (Coconut Alkanes). Which is in the product?
- **"Oleophen"** in the formula vs **"Oleophen Cosmos"** TDS — is it a single trade material or two lines?
- Fragrance written **`211878`** on the photo vs **`212878`** on the certificate — typo to confirm.
- A **blend** (Oleophen Cosmos = 5 INCIs) must be decomposed into its component INCIs at their effective product concentrations.
- IFRA allergen %s are **fractions of the fragrance**, not of the product — see §4.

---

## 2. The process the UI must implement (screen by screen)

1. **New product / upload.** User names the product, picks `product_type`
   (`leave-on` | `rinse-off`), and drags in the whole set (images + PDFs).
2. **Classify documents.** Auto-tag each file: *formula* | *ingredient doc*
   | *fragrance/IFRA cert*. User can re-tag. (Heuristics: a photo or a sheet
   of "name + %" rows is the formula; "IFRA / Safety Evaluation / allergen"
   text ⇒ fragrance cert; everything else is an ingredient doc.)
3. **Extract (suggestion).** LLM reads the formula → rows of `{name, %}`; and
   each ingredient doc → `{inci_name, cas, function, allergens?}`. Every
   extracted value carries **provenance** (which file + which page/region) and
   a **confidence** flag.
4. **Verify (THE GATE).** A single review table where the user confirms/edits
   every ingredient: maps each formula line to its resolved INCI/CAS, links
   the supporting doc, sets `function`, decomposes blends, attaches the
   fragrance's allergen list, and checks the doc-presence flags (CoA/SDS/IFRA).
   Nothing proceeds until each line is marked verified. **This is where the
   reconciliations in §1 are resolved.**
5. **Compute (deterministic).** UI sends the verified data to the engine (§3).
   The engine returns allergens, INCI, MoS, claims, gates, and the full CPSR.
6. **Render & export.** Show the Part A composition table, the Art. 19 INCI
   string, the allergen declaration, the claims verdicts, and the doc-gate
   blockers. Offer copy/export. **Re-running the same verified input must give
   byte-identical output** (determinism is a visible feature, not an
   implementation detail).

---

## 3. The input contract (UI → engine)

The engine's data model is in `pif_engine/models.py`. The UI must produce a
payload that maps 1:1 onto these structures. Below is the **JSON shape** to
target. (Note: the engine currently constructs these as Python dataclasses;
a thin JSON/YAML loader is the open ROADMAP Task 3 — the contract below is
what that loader should accept. `products/TEMPLATE.yaml` is the existing
sketch of the same idea.)

```jsonc
{
  "name": "Beard Oil",
  "product_type": "leave-on",          // "leave-on" | "rinse-off"  → sets allergen threshold
  "applied_amount_g": 10.46,           // exposure params (SCCS tables 3A/3B)
  "retention_factor": 1.0,             // ~1.0 leave-on, 0.01 rinse-off
  "body_weight_kg": 60.0,
  "sale_countries": ["BG"],

  "formula": [                         // one entry per FINAL INCI (blends already decomposed)
    {
      "ingredient": {
        "inci_name": "Prunus Amygdalus Dulcis Oil",
        "cas": "8007-69-0",
        "function": "emollient",
        "is_fragrance": false,         // true ⇒ may carry declarable allergens
        "allergens": [],               // see AllergenContent below
        "tox": null,                   // see ToxProfile below; null if none entered
        "restricted": false,           // true if Annex II–VI restricted
        "max_allowed_pct": null,       // regulatory max; engine blocks if exceeded
        "has_sds": true,               // doc-presence gates
        "has_coa": true,
        "has_ifra": false              // required true for fragrances
      },
      "concentration_pct": 69.5
    }
    // … one FormulaLine per ingredient. Duplicate INCI names (e.g. water added
    // in parts) are allowed; the engine merges them by name for the INCI list.
  ],

  "claims": [
    { "text": "Nourishes the beard", "category": "general" }
  ]
}
```

### Field reference (authoritative source = `models.py`)

**FormulaLine** — `{ ingredient, concentration_pct }`. `concentration_pct` is
% w/w in the *final product*.

**Ingredient** —
- `inci_name`, `cas`, `function` — identity (from the supporting doc).
- `is_fragrance` — fragrances/essential oils carry allergens.
- `allergens: AllergenContent[]` — declarable allergens this material brings.
- `tox: ToxProfile | null` — for the MoS calculation.
- `restricted`, `max_allowed_pct` — Annex II–VI limits; engine blocks if a
  line exceeds the limit.
- `has_sds`, `has_coa`, `has_ifra` — documentation gates (see §5). The UI sets
  these true only when the corresponding file is actually attached & verified.

**AllergenContent** — `{ name, cas, fraction }`. `fraction` is the **mass
fraction of the allergen *in that component*** (0..1), **not** in the product.

**ToxProfile** — `{ pod, dermal_absorption }`. `pod` = Point of Departure
(NOAEL) in mg/kg bw/day; `dermal_absorption` = DAp fraction 0..1 (default 0.5).
⚠️ The example tox numbers in the repo are **illustrative placeholders** — real
PoD/DAp come from the "Exposure and risk characterisation" dossier. The UI
must treat tox values as user-entered/expert-supplied, never auto-filled.

**Claim** — `{ text, category }`.

**Product-level exposure** — `daily_exposure_g = applied_amount_g ×
retention_factor`; `A (mg/kg bw/day) = daily_exposure_g × 1000 / body_weight_kg`.
These feed the MoS calc, so the UI must collect them on the product screen.

---

## 4. Allergens — the rule the UI must get right

Worked from the Beard Oil set: the fragrance "Peace on Earth" is **3%** of the
product, and the IFRA cert lists Limonene at **4.0%** *of the fragrance*.
Contribution to the product = `0.03 (line) × 0.04 (fraction)` → but note the
cert states %s at a **1.5% assessment concentration**, so the UI/verifier must
normalise the cert table to neat fractions of the fragrance before entering
them as `AllergenContent.fraction`.

The engine then (`pif_engine/allergens.py`):
- sums each allergen across all fragrance components:
  `contribution = line.concentration_pct × allergen.fraction`;
- declares those above the threshold — **0.001%** for `leave-on`,
  **0.01%** for `rinse-off` (Annex III);
- in the INCI list, appends declarable allergens **after** `Parfum/Aroma`
  (or, if there is no Parfum line, at the end — as in the real MANE INCI).

So the UI's only job for allergens is to capture, per fragrance material, the
correct `fraction` for each allergen from its IFRA cert. The thresholding,
summation, and INCI placement are the engine's deterministic job — do **not**
reimplement them in the front-end.

---

## 5. Documentation gates (UI must collect, engine enforces)

`pif_engine/cpsr.py :: check_documentation_gates` blocks finalization when:
- an ingredient is missing **CoA** or **SDS**;
- a fragrance is missing its **IFRA** certificate;
- a restricted ingredient's concentration **exceeds** its `max_allowed_pct`.

The UI must therefore tie each attached document to the flag it satisfies, and
display blockers prominently (the engine renders them under
"⛔ БЛОКЕРИ — документът НЕ е финализиран").

---

## 6. The output contract (engine → UI)

The engine exposes these (all deterministic, all renderable as UI panels):

| Engine function | UI panel |
|---|---|
| `generate_cpsr(product)` | Full CPSR markdown (Part A + Part B + labelling). Easiest single-call render. |
| `generate_inci(product)` | **The Art. 19 INCI string** — descending by %, merged duplicates, allergens after Parfum/at end. |
| `calculate_allergens` / `allergens_to_declare` | Allergen table + which cross the threshold. |
| `calculate_mos` / `product_is_safe` | Part B SED/MoS table; verdict (MoS > 100 = safe). |
| `validate_all_claims` | Claims table: `approved` / `blocked` (denigrating "free-from", medical) / `needs_evidence`. |
| `check_documentation_gates` | Blocker list (see §5). |

The reference of what "perfectly formatted" means is the committed example
output **`outputs/MANE_CPSR_generated.md`** (regenerate with
`python3 compare_mane.py`). The UI should reproduce that structure: a
composition table sorted by concentration, the INCI string, the allergen
declaration, the MoS table, claims verdicts, and the Art. 19 label checklist.

---

## 7. Acceptance test for the UI

Use the **MANE Shampoo** data (already validated in `compare_mane.py`) as the
golden case, then the **Beard Oil** set as the new case:

1. Upload the set → extract → verify → compute.
2. The rendered INCI string and composition table must match the engine's
   `generate_inci` / Part A output **exactly** (same order, merged duplicates,
   allergen — e.g. Limonene — placed last).
3. Editing a value in the verify step and recomputing must change the output
   deterministically; recomputing without edits must not change a single byte.
4. Removing a required document (e.g. a fragrance's IFRA) must surface a
   blocker and prevent finalization.

If the UI passes (1)–(4) on both products, it recreates the terminal process.

---

## 8. Open dependency on the engine

The engine currently takes Python objects, not JSON. To wire a web front-end,
the engine side needs a **loader** that accepts the §3 payload and constructs
`Product`/`Ingredient`/`FormulaLine`/`AllergenContent`/`ToxProfile` (this is
ROADMAP **Task 3 — clean YAML/JSON input**, with `products/TEMPLATE.yaml` as
the starting sketch). Build that loader here, in `cosmetic-pif-poc`, so both
the UI and the terminal share one input format. The UI should depend on that
contract, not on Python internals.
