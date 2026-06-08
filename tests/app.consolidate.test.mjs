/* jsdom тестове за клиентската логика в app/static/app.js (без браузър).
   Покрива document-first консолидирането: рецепта → редове; подкрепящите документи
   се обвързват към ред чрез AI картата от /match (тук я МОКВАМЕ — генерализира за
   произволни комплекти, не привързваме теста към конкретни файлове); съставът се
   авто-приема, алергените остават за потвърждение; и че името на суровина НИКОГА не
   изтича като INCI (грешката, която разваляше INCI списъка).

   Стартиране:  npm install && npm test   (иска devDependency „jsdom“). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPJS = fs.readFileSync(path.join(HERE, "..", "app", "static", "app.js"), "utf8");

function boot(matchResponder, canonResponder) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <input id="p-name" value="Beard Oil">
    <select id="p-type"><option value="leave-on" selected>leave-on</option></select>
    <input id="p-amount" value="2.0">
    <input id="p-countries" value="BG">
    <form id="formula-form"><details class="advanced"></details></form>
    <div id="ingredients" role="list"></div>
    <textarea id="yaml"></textarea>
    <div id="draft"></div>
    <div id="toast" hidden></div>
  </body></html>`, { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  // Мок на /match и /canonicalize — AI частта е сървърна (тествана в Python).
  window.fetch = function (url, opts) {
    const u = String(url);
    const parse = function () { try { return JSON.parse(opts.body); } catch (e) { return {}; } };
    if (u.indexOf("/canonicalize") !== -1) {
      const cres = canonResponder ? canonResponder(parse()) : { available: false, items: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(cres) });
    }
    if (u.indexOf("/match") !== -1) {
      const res = matchResponder ? matchResponder(parse()) : { available: false, matches: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(res) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  };
  window.__PIF_TEST__ = true;
  window.eval(APPJS);
  return window;
}

function intakeHTML(docs) {
  const li = docs.map((d) =>
    `<li class="intake-doc role-${d.role}" data-rms='${JSON.stringify(d.rms)}'` +
    ` data-role="${d.role}" data-filename="${d.filename}" data-error="${d.error ? "1" : ""}">` +
    `<div class="idoc-head"><span class="idoc-file">${d.filename}</span>` +
    `<span class="idoc-status"></span></div></li>`).join("");
  return `<ul class="intake-list">${li}</ul><div class="intake-flags" hidden></div>`;
}

const q = (w, sel) => Array.from(w.document.querySelectorAll(sel));

// Beard Oil комплект: рецепта (на български) + по един подкрепящ документ + аромат,
// плюс една суровина БЕЗ документ (→ непълен ред). Имената нарочно са разноезични.
const SET = [
  { role: "formula", filename: "recipe.jpg", rms: [
    { name: "Бадемово масло", dose_pct: 69.5 },
    { name: "Peace fragrance", dose_pct: 3 },
    { name: "Mystery wax", dose_pct: 27.5 },     // няма документ → непълен ред
  ]},
  { role: "ingredient", filename: "Almond Oil.pdf", rms: [
    { name: "Almond Oil", composition: [{ inci_name: "Prunus Amygdalus Dulcis Oil", pct: 100 }] }]},
  { role: "fragrance", filename: "Parfum_Peace.pdf", rms: [
    { name: "Peace", is_fragrance: true, allergens: [
      { name: "Limonene", pct_in_fragrance: 4.0 },
      { name: "Linalool", pct_in_fragrance: 1.5 }]}]},
];

// supportDocs ред: Almond=doc0, Parfum=doc1; редове: 0=Бадемово,1=Peace,2=Mystery.
const goodMap = () => ({ available: true, matches: [
  { doc: 0, row: 0, matched: true, confidence: 0.99, why: "almond=бадемово" },
  { doc: 1, row: 1, matched: true, confidence: 0.95, why: "parfum=peace" },
]});

test("AI картата обвързва документ→ред многоезично (Almond.pdf → „Бадемово масло“)", async () => {
  const w = boot(goodMap);
  w.document.getElementById("draft").innerHTML = intakeHTML(SET);
  await w.__PIF_TEST__.consolidateExtract();

  assert.equal(q(w, "#ingredients .ingredient").length, 3, "3 реда от рецептата");
  const incis = q(w, "#ingredients .ing-inci").map((i) => i.value);
  assert.ok(incis.includes("Prunus Amygdalus Dulcis Oil"),
    "българският ред получи INCI от английския документ");
  assert.equal(q(w, "#ingredients .ingredient.incomplete").length, 1,
    "само суровината без документ е непълна");
  assert.ok(q(w, "#ingredients .allergen-row[data-proposed]").length >= 2,
    "алергените остават за потвърждение");
});

test("buildYaml: реален INCI, без изтичане на име, непълният ред се пропуска", async () => {
  const w = boot(goodMap);
  w.document.getElementById("draft").innerHTML = intakeHTML(SET);
  await w.__PIF_TEST__.consolidateExtract();

  const y = w.__PIF_TEST__.buildYaml();
  assert.ok(y.includes("Prunus Amygdalus Dulcis Oil"), "реалният INCI присъства");
  assert.ok(y.includes("is_fragrance: true") && y.includes("Limonene"), "ароматът с алергените");
  assert.ok(!y.includes('inci_name: "Бадемово масло"'), "българското име НЕ става INCI");
  assert.ok(!y.includes('inci_name: "Mystery wax"'), "името на ред без INCI не изтича");
  assert.ok(!y.includes('name: "Mystery wax"'), "непълният ред изобщо не влиза в YAML");
});

test("съставът се авто-приема (без карантина) — рисково = само алергените", async () => {
  const w = boot(goodMap);
  w.document.getElementById("draft").innerHTML = intakeHTML(SET);
  await w.__PIF_TEST__.consolidateExtract();
  assert.equal(q(w, "#ingredients .ing-inci[data-proposed]").length, 0, "INCI авто-приет");
  assert.equal(q(w, "#ingredients .constituent-row[data-proposed]").length, 0, "съставът авто-приет");
});

test("inciCase уеднаквява изцяло-главни/малки имена, пази вече смесените", () => {
  const f = boot().__PIF_TEST__.inciCase;
  assert.equal(f("HELIANTHUS ANNUUS SEED OIL"), "Helianthus Annuus Seed Oil");
  assert.equal(f("CI 77491"), "CI 77491");
  assert.equal(f("PEG-40 HYDROGENATED CASTOR OIL"), "PEG-40 Hydrogenated Castor Oil");
  assert.equal(f("Simmondsia Chinensis Seed Oil"), "Simmondsia Chinensis Seed Oil");
  assert.equal(f("alpha-Isomethyl Ionone"), "alpha-Isomethyl Ionone");   // смесен → непокътнат
});

test("канонизиране: синоним→INCI и махане на не-декларируем алерген", async () => {
  const matchMap = () => ({ available: true, matches: [
    { doc: 0, row: 0, matched: true, confidence: 0.99, why: "" },
    { doc: 1, row: 1, matched: true, confidence: 0.95, why: "" },
  ]});
  const canon = (body) => ({ available: true, items: body.items.map(function (it) {
    if (it.name === "Sunflower Oil")
      return { id: it.id, canonical: "Helianthus Annuus Seed Oil", declarable: false, drop: false };
    if (it.kind === "allergen" && it.name === "Iso E Super")
      return { id: it.id, canonical: "Tetramethyl Acetyloctahydronaphthalenes", declarable: false, drop: false };
    if (it.kind === "allergen")
      return { id: it.id, canonical: it.name, declarable: true, drop: false };
    return { id: it.id, canonical: it.name, declarable: false, drop: false };
  }) });
  const w = boot(matchMap, canon);
  w.document.getElementById("draft").innerHTML = intakeHTML([
    { role: "formula", filename: "recipe.jpg", rms: [
      { name: "Витамин Е", dose_pct: 0.5 },
      { name: "Peace fragrance", dose_pct: 3 },
    ]},
    { role: "ingredient", filename: "Vitapherole.pdf", rms: [
      { name: "Vitapherole", composition: [
        { inci_name: "Tocopherol", pct: 70 },
        { inci_name: "Sunflower Oil", pct: 30 }] }]},
    { role: "fragrance", filename: "Parfum.pdf", rms: [
      { name: "Peace", is_fragrance: true, allergens: [
        { name: "Limonene", pct_in_fragrance: 4 },
        { name: "Iso E Super", pct_in_fragrance: 10 }] }]},
  ]);
  await w.__PIF_TEST__.consolidateExtract();
  const d = w.document;
  const csts = q(w, "#ingredients .cst-name").map((i) => i.value);
  assert.ok(csts.includes("Helianthus Annuus Seed Oil"), "синонимът е приведен към INCI");
  assert.ok(!csts.includes("Sunflower Oil"), "обикновеното име го няма");
  const als = q(w, "#ingredients .al-name").map((i) => i.value);
  assert.ok(als.includes("Limonene"), "истинският алерген остава");
  assert.ok(!als.some((x) => /Iso E Super|Tetramethyl/.test(x)), "не-декларируемият е премахнат");
});

test("празен списък със съставки показва подсказка (без демо данни)", () => {
  const w = boot(goodMap);
  const T = w.__PIF_TEST__;
  T.syncEmptyState();
  assert.ok(w.document.querySelector("#ingredients .ingredients-empty"),
    "празният списък показва подсказка");
  T.appendIngredient({ name: "Тест", dose: "1", inci: "Aqua" });
  assert.ok(!w.document.querySelector("#ingredients .ingredients-empty"),
    "подсказката изчезва при добавен ред");
});

test("без AI (available:false) пада към евристика и предупреждава за ключа", async () => {
  const w = boot(() => ({ available: false, matches: [], note: "no key" }));
  w.document.getElementById("draft").innerHTML = intakeHTML(SET);
  await w.__PIF_TEST__.consolidateExtract();
  const flags = w.document.querySelector("#draft .intake-flags");
  assert.ok(flags && !flags.hidden, "флаговете са показани");
  assert.ok(flags.textContent.includes("AI съпоставяне недостъпно"),
    "предупреждение за липсващ ANTHROPIC_API_KEY");
});
