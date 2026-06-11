# Combined-session plan — UX matching/INCI fixes + engine OCR & regulatory fixes

> **Why this doc exists.** Diagnosed in a UX-only session; implementation deferred to
> a session that has **both** repos checked out so UX *and* engine changes land
> together. Open a Claude Code session with `puloxtor/cosmetic-pif-ux` **and**
> `puloxtor/cosmetic-pif-poc` (both on branch `claude/epic-mccarthy-nW68A`) and work
> this checklist top to bottom.

## Context — what's broken and why
A real upload (5 MB formula photo + 8 supporting PDFs) produced a wrong ingredient
table: a supporting PDF became its own row **named after the filename**
(`1anufacturing-Flow-INCI-Castor-O`), several formula-line names are garbled
(`Ауразнто масло`, `ПК Pecee on edt6 214870`), and the composition sum is ~106%.
The failures split across two layers:

- **Engine (`pif_engine`, pinned `88eaea4`):** the formula photo is read by AI
  vision, already on `claude-opus-4-8` (`extraction/vision.py:20`) which supports
  high-res vision (≤2576px). Garbled names are inherent phone-photo OCR + a thin
  formula prompt. Inconsistency: UX `tests/test_app.py::test_engine_pin_has_required_fixes`
  asserts the vision default should be **Haiku**, but the pin defaults to **Opus** →
  that test currently fails and encodes the wrong trade-off.
- **UX (`cosmetic-pif-ux`):** on AI "no match", `applyMatchMap`
  (`app/static/app.js:632`) calls `addDocAsNewRow`, which names the row from
  `rm.name` — and the engine falls back to the **filename** when no material name is
  found (`app/engine.py:174`); no heuristic retry runs first. Also `modelInci`
  (`app/static/app.js:443`) always takes `composition[0]` regardless of %, and
  canonicalization can overwrite a bare trade-name row's INCI with an AI guess.

**User decisions:** (1) unmatched docs → try a similarity fallback, else **hold in a
"needs placing" tray**, never auto-create garbage rows; (2) do the UX fixes **and**
the engine OCR fixes together (this session).

---

## Repo A — `cosmetic-pif-ux`

### A1. No garbage rows; "needs placing" tray  *(app/static/app.js, app/templates/_draft.html, app/static/style.css)*
- In `applyMatchMap` (`app.js:622-646`) and `applyHeuristic` (`649-659`): on **no
  confident AI match**, first call existing `matchExistingRow(rm)` (`app.js:532-545`,
  similarity ≥ `MATCH_MIN`). If it returns a row → `autoAttach`. Else push the doc to
  a new `unplaced[]` list — **do not** call `addDocAsNewRow`.
- Repurpose `addDocAsNewRow` (`app.js:610-616`) into an explicit user action only,
  and name that row from the doc's INCI (`modelInci`/best constituent) — **never** the
  filename.
- Render `unplaced[]` as a small tray (markup in `_draft.html`, styles in
  `style.css`): per doc a row-picker dropdown ("прикачи към ред …") → `autoAttach`,
  plus an "add as new ingredient" escape hatch. Update `setDocStatus` →
  "за разпределяне"; surface counts via `renderIntakeFlags`.

### A2. Primary INCI = dominant constituent  *(app/static/app.js:443-446)*
- `modelInci` returns the **highest-%** constituent's `inci_name` (range → upper
  bound; `at_most` → its value; `remainder`/none → lowest), falling back to
  `composition[0]` only when no quantities exist. Improves display + `matchExistingRow`.
  Card constituent ordering unchanged (engine still orders the INCI).

### A3. Stronger, OCR-aware matcher  *(app/matching.py, app.js payload)*
- `matching.py` SYSTEM (`:25-38`): match by the **INCI the document certifies** vs the
  material identity of a possibly garbled/OCR line name; OCR noise/trade codes are
  expected; match when the document's INCI clearly corresponds even if the name is
  mangled; `matched=false` only when genuinely unsure. Keep Opus + fallback chain.
- `consolidateExtract` payload (`app.js:764-770`): add each row's **dose** to `rows`.

### A4. Canonicalization guard  *(app/canonical.py, app.js collectCanonItems/applyCanon)*
- `canonical.py` system prompt (`:24-44`): a supplier **trade name** that can't be
  confidently mapped → return unchanged (`drop=false`, `canonical`=input); **never
  invent** an INCI (kills the `Oleophen → Hippophae`-type artifact).
- `applyCanon` (`app.js:690-708`): only overwrite a row's INCI for a real change on an
  INCI-looking input; never replace a formula-derived trade name with a guess.

### A5. UX tests
- `tests/app.consolidate.test.mjs`: unmatched doc → tray, **not** a new row; heuristic
  fallback attaches by name/INCI; `modelInci` picks highest-%; explicit "add as new"
  names by INCI, not filename.
- `tests/test_matching.py`: keep contract; adjust only if payload/prompt shape changes.
- `tests/test_app.py`: keep "no Bulgarian/filename names in final INCI" assertions.

### A6. Reconcile the engine-model test  *(tests/test_app.py:411-419)*
- Change `test_engine_pin_has_required_fixes` to assert the vision `DEFAULT_MODEL` is a
  **non-empty valid Anthropic model id** (+ `extraction.filter` exists) instead of
  requiring Haiku. 429 is handled by retries (Repo B).

### A7. Pin bump  *(requirements.txt)*
- After the engine commit (Repo B), bump `pif-engine[extraction] @ …@<NEW_SHA>`;
  re-run tests.

---

## Repo B — `cosmetic-pif-poc` (engine)

### B1. OCR — formula vision  *(pif_engine/extraction/vision.py)*
- `_PROMPTS["formula"]` + `SYSTEM`: transcribe each raw-material line and dose
  **verbatim**, preserve trade names/codes, one row per line (don't merge), flag
  illegible lines in `notes` with their index, dose only as written.
- High-res: ensure images are sent without lossy pre-downscaling so Opus 4.7+/4.8
  high-res vision (≤2576px long edge) applies.
- 429 robustness: raise the Anthropic client `max_retries` (SDK backs off 429/5xx) so
  Opus vision is safe under load — removing the reason the old test wanted Haiku.

### B2. Two regulatory fixes — already specified in `docs/ENGINE_HANDOFF.md`
Apply both from that doc (paste its PROMPT section):
- **Label normalization to 100%** — add `normalized_concentrations()`; `generate_inci`
  groups/orders on normalized values; keep `consolidated_concentrations()` (worst-case)
  for MoS/allergen thresholds; reword the sum alarm; export the new fn.
- **Art. 19(1)(g) allergen placement** — insert `allergens_to_declare(product)` after
  the last ≥1% ingredient AND after the Parfum/Aroma line (not directly after Parfum).
- Update tests + the SK5071025 golden fixture; commit; push; **report the new SHA**.

### B3. (already done in `88eaea4`) nomenclature layer
Canonical naming, Annex III (incl. Reg. 2023/1545), `localize_inci`, validation — no
action; just don't regress.

---

## Sequencing (both repos available)
1. **Engine first:** B1 (OCR) + B2 (the two regulatory fixes) → run `python -m pytest -q`
   → commit → push → note the new SHA.
2. **UX:** A7 bump `requirements.txt` to that SHA → A1–A6 → run tests.
3. Deploy note: keep Railway `PIF_VISION_MODEL` unset or `claude-opus-4-8` (high-res
   Opus vision), never a weak model.

## Verification
- **Automated:** engine `python -m pytest -q`; UX `python3 -m pytest tests/ -v` and
  `node --experimental-vm-modules node_modules/.bin/jest` (jsdom) — all green.
- **Manual E2E (needs `ANTHROPIC_API_KEY`):** re-upload the real set; confirm —
  (a) **no row named after a file**; (b) the castor PDF auto-attaches or appears in the
  "needs placing" tray with a working attach picker; (c) multi-constituent rows
  (Vitapherole, Oleophen) show the **dominant** INCI as primary; (d) garbled-name lines
  still receive their datasheets via the strengthened matcher; (e) the formula photo's
  names/doses read correctly with the new vision prompt; (f) the label sum shows
  normalized-to-100% with the worst-case note.

## Key files
- **UX:** `app/static/app.js`, `app/templates/_draft.html`, `app/static/style.css`,
  `app/matching.py`, `app/canonical.py`, `tests/app.consolidate.test.mjs`,
  `tests/test_matching.py`, `tests/test_app.py`, `requirements.txt`.
- **Engine:** `pif_engine/extraction/vision.py`, plus the files named in
  `docs/ENGINE_HANDOFF.md` for the two regulatory fixes; `tests/`.

## Guardrails (from CLAUDE.md)
Engine = single source of regulatory truth; UX only orchestrates + presents.
`app/engine.py` is the only bridge to `pif_engine`. Run tests after each change. When
a ROADMAP gap closes, update both repos' `CLAUDE.md`.
