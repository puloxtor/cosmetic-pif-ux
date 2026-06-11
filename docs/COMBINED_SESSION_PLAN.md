# Combined-session plan — matching/INCI/OCR fixes across BOTH repos

> **Why this doc exists.** The fixes below span two repos: the UX
> (`puloxtor/cosmetic-pif-ux`, this repo) and the engine
> (`puloxtor/cosmetic-pif-poc`). They were planned in a UX-only session and
> **saved here, not implemented**, so a new session that has **both repos
> checked out** can do all of it in the right order. Work on branch
> `claude/epic-mccarthy-nW68A` in **both** repos (per each repo's CLAUDE.md).
>
> **Status: NOT STARTED.** Nothing in Parts A/B-OCR/C below has been coded yet.
> The two *regulatory* engine fixes (rescale-to-100% + Art.19 allergen
> placement) live in `docs/ENGINE_HANDOFF.md` and are also not started.

---

## The bug that triggered all this
A real upload (5 MB formula photo + 8 supporting PDFs) produced a wrong
ingredient table:
- a **supporting PDF became its own row named after the filename**
  (`1anufacturing-Flow-INCI-Castor-O`);
- several formula-line names are garbled (phone-photo OCR);
- the composition sums to ~106%.

Root causes split across two layers:

- **Engine layer** (`pif_engine`, pinned — edit in the *engine* repo): the formula
  photo is read by AI vision, already on the strongest model
  (`claude-opus-4-8`, `pif_engine/extraction/vision.py:20`) with high-res support
  (≤2576px). Garbled names are inherent phone-photo OCR + a thin formula prompt.
  There is also a contradictory test: `tests/test_app.py` (UX) asserts the vision
  default should be **Haiku**, but the installed pin defaults to **Opus** → that
  test currently fails and encodes the wrong trade-off.
- **UX layer** (this repo — editable now): when the AI matcher returns "no match",
  `applyMatchMap` (`app/static/app.js:632`) calls `addDocAsNewRow`, which names the
  row from `rm.name` — and the engine falls back to the **filename** when no
  material name is found (`app/engine.py:174`). No heuristic retry runs first.
  Separately, `modelInci` (`app/static/app.js:443`) always takes `composition[0]`
  regardless of %, and canonicalization can overwrite a bare trade-name row's INCI
  with an AI guess.

**User decisions baked into this plan:** (1) unmatched docs → try a similarity
fallback, else **hold in a "needs placing" tray** (never auto-create garbage
rows); (2) fix the UX **and** harden engine OCR; (3) engine vision stays on
**Opus high-res** (not Haiku) — robustness comes from retries, not a weaker model.

---

## Recommended order for a both-repos session
1. **Engine repo first** — do Part B (OCR) **and** the two regulatory fixes in
   `docs/ENGINE_HANDOFF.md` (rescale-to-100% + Art.19 placement). One engine
   branch, run `python -m pytest -q`, commit, push, note the **new SHA**.
2. **UX repo** — bump the pin to that SHA (Part C), then do Part A (UX fixes),
   then run both test suites.
3. Manual E2E with the real upload set (needs `ANTHROPIC_API_KEY`; prod has it).

---

## Part A — UX fixes (this repo)

### A1. No garbage rows; "needs placing" tray  *(app/static/app.js, app/templates/_draft.html, app/static/style.css)*
- In `applyMatchMap` (`app.js:622-646`) and `applyHeuristic` (`649-659`): when a
  support doc has **no confident AI match**, first call the existing
  `matchExistingRow(rm)` (`app.js:532-545`, name/INCI similarity ≥ `MATCH_MIN`).
  If it returns a row → `autoAttach`. If not → push the doc to a new `unplaced[]`
  list instead of calling `addDocAsNewRow`.
- Replace the default `addDocAsNewRow(rm, d.filename)` path. Keep a renamed helper
  used **only** when the user explicitly chooses "add as new ingredient", and name
  that row from the doc's INCI (`modelInci`/best constituent) — **never** the
  filename.
- Render `unplaced[]` in a small tray (new container in `_draft.html`, styled in
  `style.css`): per doc, a one-click row-picker dropdown ("прикачи към ред …")
  that calls `autoAttach`, plus an "add as new ingredient" escape hatch. Update
  `setDocStatus` to show a "за разпределяне" state.
- Surface counts in the existing intake flags (`renderIntakeFlags`).

### A2. Primary INCI = dominant constituent  *(app/static/app.js:443-446)*
- Change `modelInci` to return the **highest-percentage** constituent's
  `inci_name` (range → upper bound; `at_most` → its value; `remainder`/none →
  lowest priority), falling back to `composition[0]` only when no quantities
  exist. Improves both display and `matchExistingRow` (which calls `modelInci`).
  Card display order of constituents is unchanged (engine still orders the INCI).

### A3. Stronger, OCR-aware matcher  *(app/matching.py, app.js payload)*
- `matching.py` SYSTEM prompt (`:25-38`): emphasize matching by the **INCI the
  document certifies** vs the material identity of a possibly garbled/OCR line
  name; state that OCR noise/trade codes are expected; match when the document's
  INCI clearly corresponds to a line's material even if the name is mangled; keep
  `matched=false` only when genuinely unsure. Keep the Opus model + fallback chain.
- `consolidateExtract` payload (`app.js:764-770`): include each row's **dose** in
  the `rows` list to help disambiguate (docs already carry `inci[]`/`allergens[]`).

### A4. Canonicalization guard  *(app/canonical.py, app.js collectCanonItems/applyCanon)*
- `canonical.py` system prompt (`:24-44`): if a name is a supplier **trade name**
  that can't be confidently mapped to an official INCI, return it unchanged
  (`drop=false`, `canonical` = input) — **do not invent** an INCI (prevents the
  `Oleophen → Hippophae`-type artifact).
- `applyCanon` (`app.js:690-708`): only overwrite a row's INCI when canon returns a
  real change for an INCI-looking input; never replace a formula-derived trade name
  with a guess. Rows left without INCI stay flagged for manual/doc fill.

### A5. UX tests
- `tests/app.consolidate.test.mjs`: unmatched doc → lands in the tray, **not** a
  new row; heuristic fallback attaches by name/INCI; `modelInci` picks the
  highest-% constituent; explicit "add as new" names by INCI, not filename.
- `tests/test_matching.py`: keep the contract; adjust only if payload/prompt shape
  changes.
- `tests/test_app.py`: keep the "no Bulgarian/filename names in final INCI"
  assertions (our changes reinforce them).

### A6. Reconcile the engine-model test  *(tests/test_app.py:411-419)*
- `test_engine_pin_has_required_fixes` currently asserts `"haiku" in DEFAULT_MODEL`
  while the installed engine defaults to Opus → failing/contradictory. Since we
  want Opus high-res vision for OCR quality, change the assertion to verify the
  vision `DEFAULT_MODEL` is a **non-empty, valid Anthropic model id** (and the
  `extraction.filter` module exists) rather than requiring Haiku. The 429 concern
  is handled by retries in the engine handoff (Part B).

---

## Part B — Engine OCR handoff (do in the engine repo)
Engine repo `puloxtor/cosmetic-pif-poc`, branch `claude/epic-mccarthy-nW68A`.
Deterministic where possible; the vision prompt change is the exception.

1. **Formula vision prompt** (`pif_engine/extraction/vision.py` `_PROMPTS["formula"]`
   + `SYSTEM`): transcribe each raw-material line and dose **verbatim**, preserve
   trade names/codes, **one row per line** (don't merge), flag illegible lines in
   `notes` with their index, dose only as written.
2. **High-res images:** ensure the engine sends images without lossy
   pre-downscaling so Opus 4.7+/4.8 high-res vision (≤2576px long edge) applies
   (small text reads far better at full res — see the `claude-api` skill).
3. **429 robustness:** raise the Anthropic client `max_retries` (SDK auto-backs
   off on 429/5xx) so Opus vision is safe under load — this removes the only
   reason the old test wanted Haiku.
4. Run tests, commit, push, and **report the new commit SHA** back for Part C.

**Deploy note:** verify Railway leaves `PIF_VISION_MODEL` unset or set to
`claude-opus-4-8` (not a weak model), so high-res Opus vision is used.

> The two **regulatory** engine fixes (label rescale-to-100% + Art.19 allergen
> placement) are specified in full in **`docs/ENGINE_HANDOFF.md`** — do them on the
> same engine branch. The nomenclature layer is already in the pin (`88eaea4`).

---

## Part C — After the engine push (UX side)
- Bump `requirements.txt` engine pin to the new SHA.
- Apply the UX wiring from `docs/ENGINE_HANDOFF.md` §"After the engine push"
  (normalized vs worst-case composition in `app/engine.py::compute_from_yaml`,
  reworded sum note in `app/templates/_results.html`).
- Re-run tests; confirm formula names/doses read cleanly end-to-end.

---

## Verification
- **Automated:** `python3 -m pytest tests/ -v` and
  `node --experimental-vm-modules node_modules/.bin/jest` (jsdom). All green,
  including the updated consolidate + engine-model-test cases.
- **Manual E2E** (prod has `ANTHROPIC_API_KEY`; the dev container does not):
  re-upload the same set and confirm — (a) **no row named after a file**; (b) the
  castor PDF either auto-attaches to its line or appears in the "needs placing"
  tray with a working attach picker; (c) multi-constituent rows (Vitapherole,
  Oleophen) show the **dominant** INCI as primary; (d) garbled-name lines still
  receive their datasheets via the strengthened matcher.
- **After engine session:** with the new pin, re-upload and confirm the formula
  photo's names/doses are read correctly, and the label composition sums to 100%
  with allergens placed per Art. 19.

## Scope / guardrails
- Engine code stays the single source of regulatory truth; UX only orchestrates +
  presents (per CLAUDE.md). Raw OCR accuracy and label-sum normalization are
  **engine** items.
- `app/engine.py` remains the only bridge that imports from `pif_engine`.
- Critical files — UX: `app/static/app.js`, `app/templates/_draft.html`,
  `app/static/style.css`, `app/matching.py`, `app/canonical.py`, the three test
  files, and (Part C) `requirements.txt`. Engine: `pif_engine/extraction/vision.py`
  (+ client retry config), plus the files named in `docs/ENGINE_HANDOFF.md`.
