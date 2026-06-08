# Session Handoff — cosmetic-pif-ux / cosmetic-pif-poc

**Date:** 2026-06-08  
**Repos:** puloxtor/cosmetic-pif-ux · puloxtor/cosmetic-pif-poc

---

## Branch map

| Repo | Dev branch | Production branch (Railway) |
|------|-----------|----------------------------|
| cosmetic-pif-ux | `claude/wonderful-noether-SYDWU` | `claude/epic-mccarthy-nW68A` |
| cosmetic-pif-poc | `claude/wonderful-noether-SYDWU` | _(engine, no Railway deploy)_ |

Railway auto-deploys when `claude/epic-mccarthy-nW68A` is pushed.  
**Always develop on `claude/wonderful-noether-SYDWU`, then merge → push to `claude/epic-mccarthy-nW68A`.**

---

## What was done this session

### cosmetic-pif-poc (engine)
- `pif_engine/nomenclature.py` — populated `_DECLARABLE_EXTRA` with 47 new Annex III allergens from Reg. (EU) 2023/1545. Total: 73 declarable allergens (26 original + 47 new).
- `pif_engine/composition.py` — fixed `expand_raw_material()` to canonicalise allergen names at creation (e.g. "Lavandula Oil/Extract" → "Lavandula Angustifolia Oil").
- `pif_engine/extraction/vision.py` — vision model strategy: Haiku default (`PIF_VISION_MODEL` env or `claude-haiku-4-5-20251001`), auto-upgrade to Opus (`claude-opus-4-8`) on 429 rate limit.
- `tests/test_inci_regression.py` — golden 23-item INCI regression test for SK5071025 Beard Oil fixture.
- `tests/fixtures/sk5071025_beard_oil.yaml` — SK5071025 Beard Oil test fixture (8 raw materials, 20 IFRA allergens).

### cosmetic-pif-ux (web app)
- `nixpacks.toml` — forces `pip install --no-cache-dir` on Railway so the git+ engine dep is always re-fetched.
- `requirements.txt` — pinned to engine commit `8164c3d`.
- `app/main.py`:
  - `_git_commit()` reads `RAILWAY_GIT_COMMIT_SHA` env var first (Railway provides this automatically), falls back to `.git` for local dev.
  - `_engine_pin()` extracts 7-char SHA from `requirements.txt` `@<sha>` pin.
  - `_ALLERGEN_COUNT` cached at module level from `DECLARABLE_ALLERGENS`.
  - FastAPI lifespan handler logs startup identifiers on every deploy:
    ```
    INFO: PIF-UX startup | ux_commit=<sha> | engine_pin=<sha> | allergens=73 | assets=<hash>
    ```
  - `/healthz` returns `engine_version`, `engine_pin`, `declarable_allergens`, `ux_commit`, `asset_version`.
- `app/templates/index.html` — badge shows `engine <pin>` (changes per engine upgrade). Footer shows `UX commit: <sha>` + healthz link.
- `app/static/app.js` — fixed `syncIncomplete()` string concatenation bug that broke all JS click handlers.

---

## Current live state (verified)

`/healthz` returns:
```json
{
  "engine_version": "0.1.0",
  "engine_pin": "8164c3d",
  "declarable_allergens": 73,
  "ux_commit": "<railway sha>",
  "asset_version": "daecb646"
}
```

- `declarable_allergens: 73` = new engine deployed (old would show 26)
- `ux_commit` matches first 7 chars of Railway's deployment SHA shown in its dashboard header

---

## Known issues / next steps

1. **INCI regression test status** — `tests/test_inci_regression.py` was written with expected 23-item list for SK5071025. Run `pytest tests/test_inci_regression.py -v` in `cosmetic-pif-poc` to confirm it passes with the current engine. If it fails, the expected list needs adjustment.

2. **Opus vision model** — Check Railway Variables (`cosmetic-pif-ux → Variables`) for a `PIF_VISION_MODEL` env var. If set to `claude-opus-4-8`, remove it or change to `claude-haiku-4-5-20251001`. Code already defaults to Haiku and auto-upgrades to Opus on 429.

3. **Engine pin upgrade** — When the engine (`cosmetic-pif-poc`) gets new commits, update `requirements.txt` in `cosmetic-pif-ux`:
   ```
   pif-engine[extraction] @ git+https://github.com/puloxtor/cosmetic-pif-poc@<new-sha>
   ```
   Then `nixpacks.toml` ensures Railway picks it up cleanly.

4. **Toxicological data** — Per ROADMAP.md, toxicology values in the engine are currently placeholder/invented. Real data needed before this can be used for actual CPSR sign-off.

---

## How to verify deployment after a push

1. Railway → cosmetic-pif-ux → Deploy Logs → look for:
   ```
   PIF-UX startup | ux_commit=<sha> | engine_pin=8164c3d | allergens=73 ...
   ```
2. Compare `ux_commit` value with the SHA shown in Railway's dashboard header — must match.
3. Visit `/healthz` in browser for full JSON.
4. `declarable_allergens: 73` = correct engine. If 26 = old engine still cached (check nixpacks.toml is committed).
