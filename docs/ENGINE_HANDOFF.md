# Engine handoff — ONE remaining fix: Art. 19 allergen placement

> **Status:** the nomenclature layer originally planned here is **already
> implemented** in the engine (`pif_engine/nomenclature.py` at pin `88eaea4`:
> canonical naming + synonyms, Annex III declarable list incl. Reg. 2023/1545,
> `localize_inci`, validation framework). Confirmed by live output. **One legal
> defect remains**, confirmed in the `88eaea4` source and in production output.
>
> **How to use:** in a Claude Code session on `puloxtor/cosmetic-pif-poc`
> (branch `claude/epic-mccarthy-nW68A`, per CLAUDE.md), paste the prompt below.
> Then bump the UX pin to the new SHA.

---

===== PROMPT START =====

Fix an Art. 19(1)(g) compliance bug in `pif_engine/allergens.py::generate_inci`
on branch `claude/epic-mccarthy-nW68A`.

**The bug (confirmed live):** declared allergens are spliced into the INCI list
immediately after the `Parfum`/`Aroma` line. When ingredients ≥1% come AFTER
Parfum, the sub-1% allergens land BEFORE ≥1% ingredients. Real production case:

    … Argania Spinosa Kernel Oil (3%), Parfum (3%), Limonene (0.12%), Linalool
    (0.047%), Coumarin (0.018%), Citral (0.0064%), Eugenol (0.0014%),
    Tocopherol (2.1%), Helianthus Annuus Seed Oil (1.175%), Simmondsia
    Chinensis Seed Oil (1.0%), …

Regulation 1223/2009 Art. 19(1)(g): ingredients <1% may be listed in any order
**after** those >1%. So the allergens (all <1%) must come after Tocopherol,
Helianthus and Simmondsia.

**The fix:** in `generate_inci`, stop extending the list at the Parfum line.
Build the ordered list (≥1% descending, then <1%), then insert
`allergens_to_declare(product)` at the position after BOTH:
  (a) the last ingredient with concentration ≥ 1.0, and
  (b) the Parfum/Aroma line (so they still follow Parfum when Parfum itself is
      in the <1% tail).
Keep the existing fallback (no Parfum line → append at the end, deduped) and the
final `localize_inci(...)` mapping. Do not change ordering/merging/suppression
otherwise.

**Expected output for the case above:**

    …, Coconut Alkanes, Argania Spinosa Kernel Oil, Parfum, Tocopherol,
    Helianthus Annuus Seed Oil, Simmondsia Chinensis Seed Oil, Limonene,
    Linalool, Coumarin, Citral, Eugenol, Olea Europaea Fruit Oil, Cucurbita
    Pepo Seed Oil, Hippophae Rhamnoides Oil

**Tests (`tests/`):**
1. Parfum 3% + ingredients 2.1% / 1.175% / 1.0% after it + declared allergens →
   allergens appear after the 1.0% ingredient, before the <1% tail.
2. Parfum 0.5% (in the <1% tail) → allergens directly after Parfum (current
   behaviour stays correct).
3. No Parfum line but declarable allergens → appended at the end, deduped
   (existing behaviour preserved).
4. The SK5071025 beard-oil golden fixture still passes with the new order.

Run `python -m pytest -q`, fix anything that asserted the old placement, commit
("fix(inci): place declared allergens after all >=1% ingredients (Art. 19)"),
push to `claude/epic-mccarthy-nW68A`, and **report the new commit SHA** so the
UX pin can be bumped.

===== PROMPT END =====

---

## After the engine push (UX side, this repo)
1. Bump `requirements.txt`: `…cosmetic-pif-poc@<new SHA>`.
2. Push; Railway rebuilds and the INCI order becomes compliant.

## Known non-code issue (data, not engine)
Live recipe sums to **103.09% ≠ 100%** — the engine alarms correctly instead of
normalizing. Doses must be corrected by the formulator; note a rescale could push
Simmondsia (1.0%) below 1%, changing its group.
