/* Форма → YAML за енджина + дребни UX подобрения.
   Формата е само удобство за въвеждане: тя генерира точно онзи YAML, който
   енджинът вече приема, така че бекендът и детерминизмът остават непокътнати. */
(function () {
  "use strict";

  var SVG_TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

  // Демо продукт (същият като примерната формула) — за да не е празно при старт.
  var DEMO = [
    { name: "Sweet Almond Oil", dose: "96.5", inci: "Prunus Amygdalus Dulcis Oil", fragrance: false, allergens: [] },
    { name: "Parfum (пример)", dose: "3.0", inci: "", fragrance: true,
      allergens: [{ name: "Limonene", pct: "4.0" }, { name: "Linalool", pct: "1.5" }] },
    { name: "Tocopherol", dose: "0.5", inci: "Tocopherol", fragrance: false, allergens: [] }
  ];

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function allergenRow(a) {
    var row = el("div", { class: "allergen-row", role: "listitem" });
    row.appendChild(el("label", { class: "mini" }, 'Алерген<input type="text" class="al-name" value="' +
      escAttr(a && a.name) + '" placeholder="напр. Limonene">'));
    row.appendChild(el("label", { class: "mini" }, '% в аромата<input type="number" class="al-pct" step="0.01" min="0" inputmode="decimal" value="' +
      escAttr(a && a.pct) + '">'));
    var del = el("button", { type: "button", class: "icon-btn", "aria-label": "Премахни алергена" }, SVG_TRASH);
    del.addEventListener("click", function () { row.remove(); });
    row.appendChild(del);
    return row;
  }

  function ingredientCard(data) {
    data = data || { name: "", dose: "", inci: "", fragrance: false, allergens: [] };
    var card = el("div", { class: "ingredient", role: "listitem" });

    card.appendChild(el("label", { class: "field grow" }, 'Съставка<input type="text" class="ing-name" value="' +
      escAttr(data.name) + '" placeholder="напр. Sweet Almond Oil" autocomplete="off">'));
    card.appendChild(el("label", { class: "field narrow" }, 'Доза %<input type="number" class="ing-dose" step="0.01" min="0" inputmode="decimal" value="' +
      escAttr(data.dose) + '">'));

    var inciLabel = el("label", { class: "field grow ing-inci-wrap" }, 'INCI име<input type="text" class="ing-inci" value="' +
      escAttr(data.inci) + '" placeholder="напр. Prunus Amygdalus Dulcis Oil" autocomplete="off">');
    card.appendChild(inciLabel);

    var del = el("button", { type: "button", class: "icon-btn row-del", "aria-label": "Премахни съставката" }, SVG_TRASH);
    del.addEventListener("click", function () { card.remove(); });
    card.appendChild(del);

    // Аромат-секция (прогресивно разкриване).
    var fragWrap = el("div", { class: "frag-wrap" });
    var togId = "frag-" + Math.random().toString(36).slice(2, 8);
    var tog = el("label", { class: "inline frag-toggle" },
      '<input type="checkbox" class="ing-frag" id="' + togId + '"' + (data.fragrance ? " checked" : "") +
      '> Това е аромат / парфюм');
    fragWrap.appendChild(tog);

    var allergens = el("div", { class: "allergens", role: "list" });
    var addAl = el("button", { type: "button", class: "btn-ghost small" }, "+ Добави алерген");
    addAl.addEventListener("click", function () { allergens.appendChild(allergenRow()); });
    var alBlock = el("div", { class: "allergen-block" });
    alBlock.appendChild(el("p", { class: "field-hint" }, "Алергени по Приложение III и техния % в самия аромат."));
    alBlock.appendChild(allergens);
    alBlock.appendChild(addAl);
    fragWrap.appendChild(alBlock);
    card.appendChild(fragWrap);

    function syncFrag() {
      var on = tog.querySelector("input").checked;
      card.classList.toggle("is-fragrance", on);
    }
    tog.querySelector("input").addEventListener("change", syncFrag);
    (data.allergens || []).forEach(function (a) { allergens.appendChild(allergenRow(a)); });
    if (data.fragrance && (!data.allergens || !data.allergens.length)) allergens.appendChild(allergenRow());
    syncFrag();

    return card;
  }

  function escAttr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"); }
  function yq(s) { return '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function num(s, dflt) { var v = parseFloat(s); return isNaN(v) ? (dflt == null ? 0 : dflt) : v; }

  function buildYaml() {
    var name = document.getElementById("p-name").value || "Продукт";
    var type = document.getElementById("p-type").value || "leave-on";
    var amount = num(document.getElementById("p-amount").value, 1.0);
    var countries = (document.getElementById("p-countries").value || "BG")
      .split(",").map(function (c) { return c.trim(); }).filter(Boolean);

    var lines = [];
    lines.push("product:");
    lines.push("  name: " + yq(name));
    lines.push("  product_type: " + yq(type));
    lines.push("  applied_amount_g: " + amount);
    lines.push("  retention_factor: 1.0");
    lines.push("  sale_countries: [" + countries.map(yq).join(", ") + "]");
    lines.push("");
    lines.push("raw_materials:");

    var cards = document.querySelectorAll("#ingredients .ingredient");
    cards.forEach(function (card) {
      var nm = card.querySelector(".ing-name").value.trim();
      if (!nm) return;
      var dose = num(card.querySelector(".ing-dose").value, 0);
      var isFrag = card.querySelector(".ing-frag").checked;
      lines.push("  - name: " + yq(nm));
      lines.push("    dose_pct: " + dose);
      if (isFrag) {
        lines.push("    is_fragrance: true");
        lines.push("    allergens:");
        card.querySelectorAll(".allergen-row").forEach(function (ar) {
          var an = ar.querySelector(".al-name").value.trim();
          if (!an) return;
          var ap = num(ar.querySelector(".al-pct").value, 0);
          lines.push("      - { name: " + yq(an) + ", pct_in_fragrance: " + ap + " }");
        });
      } else {
        var inci = card.querySelector(".ing-inci").value.trim() || nm;
        lines.push("    composition:");
        lines.push("      - { inci_name: " + yq(inci) + ", pct: 100 }");
      }
    });
    return lines.join("\n") + "\n";
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("show"); t.hidden = true; }, 3000);
  }

  // --- инициализация ---
  document.addEventListener("DOMContentLoaded", function () {
    var box = document.getElementById("ingredients");
    if (box) DEMO.forEach(function (d) { box.appendChild(ingredientCard(d)); });

    var add = document.getElementById("add-ingredient");
    if (add) add.addEventListener("click", function () {
      var card = ingredientCard();
      box.appendChild(card);
      var inp = card.querySelector(".ing-name");
      if (inp) inp.focus();
    });
  });

  // Преди заявката: ако „Разширен режим“ е затворен, генерирай YAML от формата.
  document.body.addEventListener("htmx:configRequest", function (e) {
    if (e.detail.elt && e.detail.elt.id === "formula-form") {
      var adv = document.querySelector("#formula-form .advanced");
      if (!(adv && adv.open)) {
        var y = buildYaml();
        var ta = document.getElementById("yaml");
        if (ta) ta.value = y;
        e.detail.parameters["formula"] = y;
      }
    }
  });

  // Копиране в клипборда (резултатите се вмъкват от HTMX → делегиране).
  document.body.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-copy]") : null;
    if (!btn) return;
    var sel = btn.getAttribute("data-copy");
    var src = document.querySelector(sel);
    if (!src) return;
    var text = src.textContent.trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Копирано ✓"); });
    } else {
      var r = document.createRange(); r.selectNode(src);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      try { document.execCommand("copy"); toast("Копирано ✓"); } catch (_) {}
      s.removeAllRanges();
    }
  });
})();
