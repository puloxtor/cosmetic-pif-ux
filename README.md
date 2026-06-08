# cosmetic-pif-ux

Уеб UX (FastAPI + HTMX) над детерминистичния козметичен **PIF/CPSR енджин**
([`cosmetic-pif-poc`](https://github.com/puloxtor/cosmetic-pif-poc)).

Една сесия = един продукт: попълваш формулата (суровини + дози), по желание
качваш доставчиков документ (извлича се **чернова** композиция/алергени), и
получаваш **таблицата с разбивката + генерирания INCI** (по избор и пълния CPSR).

> Енджинът е **пинована зависимост** (виж `requirements.txt`). Този UX само го
> вика — не съдържа и не може да променя енджин логика. Единствен източник на
> истина за всички числа е `pif_engine`.

## Стартиране

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# отвори http://127.0.0.1:8000
```

За AI-зрението (снимани/сканирани документи) задай ключ в средата:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Цифровите PDF-и се четат детерминистично и не изискват ключ.

Същият ключ захранва и **AI съпоставянето „документ → ред от рецептата“** (свързва
напр. „Бадемово масло“ с `Almond Oil.pdf` между езици/търговски имена). По
подразбиране ползва същия модел като зрението (`PIF_VISION_MODEL`, иначе
`claude-opus-4-8`); смени го независимо с `PIF_MATCH_MODEL`. Без ключ UX-ът пада към
проста евристика по име и го показва в прегледа.

Същият ключ върши и **канонизиране на INCI имената** (Sunflower Oil → Helianthus
Annuus Seed Oil, единен регистър, само декларируеми Анекс III алергени за ароматите);
модел `PIF_CANON_MODEL`. Без ключ имената поне се привеждат към единен регистър.

## Локална разработка срещу локален енджин

Ако работиш и по енджина едновременно, инсталирай го editable вместо от git:

```bash
pip install -e ../cosmetic-pif-poc[extraction]
pip install fastapi "uvicorn[standard]" jinja2 python-multipart httpx pytest
```

## Тестове

```bash
pytest -q                 # бекенд + класификация на документи
npm install && npm test   # клиентска логика (app.js) през jsdom — по избор
```

Билд-целта на интейка (какво трябва да възпроизведе UX-ът: качване на комплект
→ таблица + INCI) е описана в [`docs/UX_INTAKE_SPEC.md`](docs/UX_INTAKE_SPEC.md).

## Как да вдигнеш версията на енджина

Смени комита/тага в `requirements.txt` (`...@<нов-комит>`), преинсталирай и
тествай. UX-ът никога не редактира енджина — само сменя на коя негова версия сочи.

## Деплой на Railway

UX-ът е готов за Railway (Nixpacks). Стартовата команда е в `Procfile` и слуша
на `0.0.0.0:$PORT`, който Railway подава автоматично.

1. В Railway: **New Project → Deploy from GitHub repo** → избери
   `puloxtor/cosmetic-pif-ux` (бранч `claude/gallant-archimedes-jNMzz`).
2. Railway открива Python по `requirements.txt`, инсталира всичко (енджинът се
   клонира от **публичното** `cosmetic-pif-poc` — не трябват креденшъли) и пуска
   `web` процеса от `Procfile`.
3. (По избор) За AI-зрението: във **Variables** добави `ANTHROPIC_API_KEY`.
   Без него цифровите PDF-и пак се четат; само снимани/сканирани документи спират.
4. **Settings → Networking → Generate Domain**, за да получиш публичен URL.

> Смяна на версията на енджина = смени комита в `requirements.txt` и Railway
> ще пресъбере при следващия push.

## Офлайн HTMX (по избор)

UX-ът зарежда HTMX от CDN. За напълно офлайн употреба свали го локално и смени
`src` в `app/templates/index.html` на `/static/htmx.min.js`:

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js \
  -o app/static/htmx.min.js
```
