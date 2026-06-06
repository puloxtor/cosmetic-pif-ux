/* jsdom тестове за клиентската логика в app/static/app.js (без браузър).
   Покрива document-first консолидирането: рецепта → редове; подкрепящи документи →
   авто-съпоставяне и допълване; алергените остават за потвърждение; и че името на
   суровина НИКОГА не изтича като INCI (грешката, която разваляше INCI списъка).

   Стартиране:  npm install && npm test   (иска devDependency „jsdom“). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPJS = fs.readFileSync(path.join(HERE, "..", "app", "static", "app.js"), "utf8");

function boot() {
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
  // Element.scrollIntoView не съществува в jsdom — добавяме no-op, за да не гърми.
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.__PIF_TEST__ = true;       // активира тестовата кукичка в края на app.js
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

// Beard Oil комплект (docs/UX_INTAKE_SPEC.md §1): рецепта + по един подкрепящ
// документ на суровина + аромат/IFRA, плюс една суровина БЕЗ съответен документ.
const DOCS = [
  { role: "formula", filename: "recipe.jpg", rms: [
    { name: "Almond oil", dose_pct: 69.5 },
    { name: "Peace fragrance", dose_pct: 3 },
    { name: "Mystery wax", dose_pct: 27.5 },   // няма съответен документ → непълен ред
  ]},
  { role: "ingredient", filename: "Almond Oil.pdf", rms: [
    { name: "Almond Oil", composition: [{ inci_name: "Prunus Amygdalus Dulcis Oil", pct: 100 }] },
  ]},
  { role: "fragrance", filename: "Parfum_Peace.pdf", rms: [
    { name: "Peace fragrance", is_fragrance: true, allergens: [
      { name: "Limonene", pct_in_fragrance: 4.0 },
      { name: "Linalool", pct_in_fragrance: 1.5 },
    ]},
  ]},
];

test("рецептата дава редовете; документите ги допълват; рискът (алергени) се пази", () => {
  const w = boot();
  const T = w.__PIF_TEST__;
  assert.ok(T && T.consolidateExtract && T.buildYaml, "тестовата кукичка е изложена");

  w.document.getElementById("draft").innerHTML = intakeHTML(DOCS);
  T.consolidateExtract();

  const d = w.document;
  const rows = d.querySelectorAll("#ingredients .ingredient");
  assert.equal(rows.length, 3, "3 реда, посети от рецептата");

  const incis = Array.from(d.querySelectorAll("#ingredients .ing-inci")).map((i) => i.value);
  assert.ok(incis.includes("Prunus Amygdalus Dulcis Oil"),
    "INCI на бадема е допълнен от съответния документ");

  // суровина без документ → точно един „непълен“ ред (блокира изчислението)
  assert.equal(d.querySelectorAll("#ingredients .ingredient.incomplete").length, 1,
    "точно един непълен ред (Mystery wax)");

  // алергените от аромата са ПРЕДЛОЖЕНИЕ (рисково → искат потвърждение)
  assert.ok(d.querySelectorAll("#ingredients .allergen-row[data-proposed]").length >= 2,
    "извлечените алергени остават за потвърждение");
});

test("buildYaml: реален INCI, без изтичане на име, непълният ред се пропуска", () => {
  const w = boot();
  const T = w.__PIF_TEST__;
  w.document.getElementById("draft").innerHTML = intakeHTML(DOCS);
  T.consolidateExtract();

  const y = T.buildYaml();
  assert.ok(y.includes("Prunus Amygdalus Dulcis Oil"), "YAML съдържа реалния INCI");
  assert.ok(y.includes("is_fragrance: true") && y.includes("Limonene"),
    "ароматът се записва с алергените си");
  // ключовата регресия: името на суровината НЕ бива да става inci_name
  assert.ok(!y.includes('inci_name: "Mystery wax"'),
    "името на суровина без INCI не изтича като INCI");
  assert.ok(!y.includes('inci_name: "Almond oil"'),
    "името от рецептата не се ползва вместо реалния INCI");
  // непълен ред не се сериализира изобщо (енджинът не приема суровина без състав)
  assert.ok(!y.includes('name: "Mystery wax"'),
    "непълният ред изобщо не влиза в YAML");
});

test("състав (oil/blend) се авто-приема — без карантина за състава", () => {
  const w = boot();
  const T = w.__PIF_TEST__;
  w.document.getElementById("draft").innerHTML = intakeHTML([
    { role: "formula", filename: "recipe.jpg", rms: [{ name: "Almond oil", dose_pct: 100 }] },
    { role: "ingredient", filename: "Almond Oil.pdf", rms: [
      { name: "Almond Oil", composition: [{ inci_name: "Prunus Amygdalus Dulcis Oil", pct: 100 }] }]},
  ]);
  T.consolidateExtract();
  const d = w.document;
  // съставът/INCI не носи data-proposed (рисково = само алергени)
  assert.equal(d.querySelectorAll("#ingredients .ing-inci[data-proposed]").length, 0,
    "извлеченият състав е авто-приет");
  assert.equal(d.querySelectorAll("#ingredients .ingredient.incomplete").length, 0,
    "бадемът е допълнен → няма непълни редове");
});
