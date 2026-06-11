# Engine handoff — two fixes: Art. 19 allergen placement + rescale-to-100%

> **Status:** the nomenclature layer is already in the engine (`nomenclature.py`
> at pin `88eaea4`: canonical naming, Annex III incl. Reg. 2023/1545,
> `localize_inci`, validation). Two regulatory defects remain, both confirmed in
> the `88eaea4` source and in production output.
>
> **How to use:** in a Claude Code session on `puloxtor/cosmetic-pif-poc`
> (branch `claude/epic-mccarthy-nW68A`, per CLAUDE.md), paste the PROMPT section.
> Then bring the new commit SHA back to the UX session.

---

===== PROMPT START =====

Make two regulatory fixes to `pif_engine` on branch `claude/epic-mccarthy-nW68A`.
Deterministic only (no LLM). Engine already does: worst-case = upper bound of
ranges; merge duplicate INCI; allergen thresholds; Annex III filtering.

## Fix 1 — Normalize the label composition to 100% (keep worst-case for safety)
Recipes routinely sum to ≠100% (worst-case upper bounds stack; fragrance added
"on top"). The live beard oil sums to **103.09%**. Policy decision: **the LABEL
view is rescaled proportionally to 100%**, while the **safety/MoS view keeps the
actual worst-case concentrations**. Two views per ingredient.

- Add to `pif_engine/composition.py` (or `allergens.py`, wherever
  `consolidated_concentrations` lives):
  ```python
  def normalized_concentrations(product) -> dict[str, float]:
      """Съставът, нормализиран до 100% за ЕТИКЕТА (пропорционално).
      Безопасността/MoS ползват consolidated_concentrations (най-лоши, реални)."""
      totals = consolidated_concentrations(product)
      s = sum(totals.values())
      if s <= 0:
          return dict(totals)
      return {k: v * 100.0 / s for k, v in totals.items()}
  ```
- **`generate_inci` must group/order on the NORMALIZED concentrations**, because
  rescaling can move an ingredient across the 1% boundary (e.g. Simmondsia 1.0%
  worst-case → 0.97% normalized → belongs in the <1% block). So: consolidate →
  rescale to 100% → split ≥1% (desc) / <1% → then the Fix 2 allergen placement.
  (Order *within* each block is unchanged since rescale is proportional; only the
  boundary membership can change — that's the point.)
- Keep `consolidated_concentrations` (worst-case) unchanged — `toxicology`/MoS and
  the allergen-threshold decision (`allergens_to_declare`) keep using it
  (conservative: never under-declare). Do NOT rescale those.
- Reword the `build_product` sum alarm from *"не нормализирам"* to: the sum is
  X%; **for the label it's normalized to 100%; for safety the actual (worst-case)
  concentrations are used**; check the input.
- Export `normalized_concentrations` from `pif_engine/__init__.py`.

## Fix 2 — Art. 19(1)(g) allergen placement
Declared allergens are currently spliced into the INCI right after the `Parfum`
line, so sub-1% allergens land BEFORE ≥1% ingredients that follow Parfum
(Parfum 3% → Tocopherol 2.1% → Helianthus 1.175% → Simmondsia ~0.97%). Fix
`generate_inci`: build the ordered list (on normalized concentrations, per Fix 1),
then insert `allergens_to_declare(product)` at the position **after both** (a) the
last ingredient ≥1% and (b) the Parfum/Aroma line — i.e. at the head of the <1%
block, or right after Parfum if Parfum itself is <1%. Keep the no-Parfum fallback
(append at end, deduped) and the final `localize_inci(...)` mapping.

**Expected INCI for the live case (after both fixes):**
```
Prunus Amygdalus Dulcis Oil, Ricinus Communis Seed Oil, Coconut Alkanes,
Argania Spinosa Kernel Oil, Parfum, Tocopherol, Helianthus Annuus Seed Oil,
Limonene, Linalool, Coumarin, Citral, Eugenol, Simmondsia Chinensis Seed Oil,
Olea Europaea Fruit Oil, Cucurbita Pepo Seed Oil, Hippophae Rhamnoides Oil
```
(≥1% after normalization: Prunus, Ricinus, Coconut Alkanes, Argania, Parfum,
Tocopherol, Helianthus — descending; then allergens; then the <1% tail incl.
Simmondsia at ~0.97%. Verify exact boundary against the normalized numbers.)

## Tests (`tests/`)
- `normalized_concentrations`: a 103.09% product → values sum to 100.0 (±1e-6),
  proportions preserved.
- Boundary: ingredient at exactly 1.0% worst-case in a >100% product → normalized
  <1% → appears in the <1% block of `generate_inci`.
- Placement: Parfum 3% + ≥1% ingredients after it → allergens after the last ≥1%,
  not directly after Parfum. Parfum <1% → allergens directly after Parfum.
- No-Parfum + declarable allergens → appended at end, deduped.
- MoS/`toxicology` + `allergens_to_declare` still read worst-case (unchanged).
- The SK5071025 golden fixture still passes (update its expected INCI to the new,
  correct order if needed — confirm the change is the intended fix).

Run `python -m pytest -q`, fix anything that asserted old behaviour, commit
("feat(inci): normalize label to 100%; fix Art.19 allergen placement"), push to
`claude/epic-mccarthy-nW68A`, and **report the new commit SHA**.

===== PROMPT END =====

---

## After the engine push (UX side, this repo — I'll do these)
1. Bump `requirements.txt` engine pin to the new SHA.
2. `app/engine.py::compute_from_yaml`: use `normalized_concentrations` for the
   displayed composition table (sum 100%); keep `total`/worst-case to show the
   "was X% → normalized" note; MoS (slice 2) uses worst-case.
3. Reflect the reworded sum note in `_results.html`. Push.
