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

## Локална разработка срещу локален енджин

Ако работиш и по енджина едновременно, инсталирай го editable вместо от git:

```bash
pip install -e ../cosmetic-pif-poc[extraction]
pip install fastapi "uvicorn[standard]" jinja2 python-multipart httpx pytest
```

## Тестове

```bash
pytest -q
```

## Как да вдигнеш версията на енджина

Смени комита/тага в `requirements.txt` (`...@<нов-комит>`), преинсталирай и
тествай. UX-ът никога не редактира енджина — само сменя на коя негова версия сочи.

## Офлайн HTMX (по избор)

UX-ът зарежда HTMX от CDN. За напълно офлайн употреба свали го локално и смени
`src` в `app/templates/index.html` на `/static/htmx.min.js`:

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js \
  -o app/static/htmx.min.js
```
