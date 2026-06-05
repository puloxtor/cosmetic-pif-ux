/* Форма → YAML за енджина + извличане от документи + дребни UX подобрения.
   Формата е само удобство за въвеждане: тя генерира точно онзи YAML, който
   енджинът вече приема, така че бекендът и детерминизмът остават непокътнати.
   Числата от извличане са ПРЕДЛОЖЕНИЕ — проверяват се от човек. */
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
  function escAttr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"); }
  function escHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function yq(s) { return '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function num(s, dflt) { var v = parseFloat(s); return isNaN(v) ? (dflt == null ? 0 : dflt) : v; }
  function isNum(s) { return s !== "" && s != null && !isNaN(parseFloat(s)) && isFinite(s); }

  // --- мапване: чернова суровина от енджина → модел за реда във формата ---
  function isSimpleSingle(comp) {
    if (!comp || comp.length !== 1) return false;
    var c = comp[0];
    return c.range == null && c.at_most == null && !c.remainder &&
      (c.pct == null || Number(c.pct) === 100);
  }
  function normalizeRm(rm) {
    var dose = isNum(rm.dose_pct) ? String(rm.dose_pct) : "";
    if (rm.is_fragrance) {
      return {
        name: rm.name || "", dose: dose, fragrance: true, inci: "",
        allergens: (rm.allergens || []).map(function (a) {
          return { name: a.name || "", pct: isNum(a.pct_in_fragrance) ? String(a.pct_in_fragrance) : "" };
        }),
        composition: null
      };
    }
    var comp = rm.composition || [];
    if (isSimpleSingle(comp)) {
      return { name: rm.name || "", dose: dose, fragrance: false,
        inci: comp[0] ? (comp[0].inci_name || "") : "", allergens: [], composition: null };
    }
    // Сложен/многосъставен състав → запазваме точно (нужно за INCI + таблицата).
    return { name: rm.name || "", dose: dose, fragrance: false, inci: "",
      allergens: [], composition: comp };
  }

  function amountLabel(c) {
    if (c.remainder) return "остатък";
    if (c.range) return c.range[0] + "–" + c.range[1] + "%";
    if (c.at_most != null) return "до " + c.at_most + "%";
    if (c.pct != null) return c.pct + "%";
    return "?";
  }

  function allergenRow(a) {
    var row = el("div", { class: "allergen-row", role: "listitem" });
    row.appendChild(el("label", { class: "mini" }, 'Алерген<input type="text" class="al-name" value="' +
      escAttr(a && a.name) + '" placeholder="напр. Limonene">'));
    row.appendChild(el("label", { class: "mini" }, '% в аромата<input type="number" class="al-pct" step="any" min="0" inputmode="decimal" value="' +
      escAttr(a && a.pct) + '">'));
    var del = el("button", { type: "button", class: "icon-btn", "aria-label": "Премахни алергена" }, SVG_TRASH);
    del.addEventListener("click", function () { row.remove(); });
    row.appendChild(del);
    return row;
  }

  function ingredientCard(data) {
    data = data || { name: "", dose: "", inci: "", fragrance: false, allergens: [], composition: null };
    var rich = !!(data.composition && data.composition.length);
    var card = el("div", { class: "ingredient", role: "listitem" });
    if (rich) card._composition = data.composition;

    card.appendChild(el("label", { class: "field grow" }, 'Съставка<input type="text" class="ing-name" value="' +
      escAttr(data.name) + '" placeholder="напр. Sweet Almond Oil" autocomplete="off">'));

    var doseEmpty = !isNum(data.dose);
    card.appendChild(el("label", { class: "field narrow" }, 'Доза %<input type="number" class="ing-dose' +
      (doseEmpty && (data.name) ? " invalid" : "") + '" step="any" min="0" inputmode="decimal" value="' +
      escAttr(data.dose) + '">'));

    // Прост едно-INCI вход (за ръчни и едносъставни извлечени суровини).
    var inciLabel = el("label", { class: "field grow ing-inci-wrap" }, 'INCI име<input type="text" class="ing-inci" value="' +
      escAttr(data.inci) + '" placeholder="напр. Prunus Amygdalus Dulcis Oil" autocomplete="off">');
    card.appendChild(inciLabel);

    // Запазен състав от даташийта (много INCI / диапазони) — без загуба на данни.
    if (rich) {
      inciLabel.style.display = "none";
      var comp = data.composition;
      var wrap = el("div", { class: "field grow comp-wrap" });
      if (comp.length > 1) {
        var opts = comp.map(function (c, i) {
          return '<option value="' + i + '">' + escHtml(c.inci_name) + '</option>';
        }).join("");
        wrap.appendChild(el("label", { class: "field" }, "Основен INCI" +
          '<select class="ing-primary">' + opts + '</select>'));
      }
      var sum = comp.map(function (c) { return escHtml(c.inci_name) + " (" + escHtml(amountLabel(c)) + ")"; }).join(", ");
      wrap.appendChild(el("p", { class: "comp-summary" }, "от даташийта: " + sum));
      card.appendChild(wrap);
    }

    var del = el("button", { type: "button", class: "icon-btn row-del", "aria-label": "Премахни съставката" }, SVG_TRASH);
    del.addEventListener("click", function () { card.remove(); });
    card.appendChild(del);

    // Аромат-секция (прогресивно разкриване) — само за не-богати редове.
    if (!rich) {
      var fragWrap = el("div", { class: "frag-wrap" });
      var tog = el("label", { class: "inline frag-toggle" },
        '<input type="checkbox" class="ing-frag"' + (data.fragrance ? " checked" : "") +
        '> Аромат/парфюм (носи алергени)');
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

      var togInput = tog.querySelector("input");
      function syncFrag() { card.classList.toggle("is-fragrance", togInput.checked); }
      togInput.addEventListener("change", syncFrag);
      (data.allergens || []).forEach(function (a) { allergens.appendChild(allergenRow(a)); });
      if (data.fragrance && (!data.allergens || !data.allergens.length)) allergens.appendChild(allergenRow());
      syncFrag();
    }

    return card;
  }

  function appendIngredient(data, opts) {
    var box = document.getElementById("ingredients");
    if (!box) return null;
    var card = ingredientCard(data);
    box.appendChild(card);
    return card;
  }

  // --- сериализация форма → YAML ---
  function compLine(c) {
    var parts = ["inci_name: " + yq(c.inci_name)];
    if (c.cas) parts.push("cas: " + yq(c.cas));
    if (c.remainder) parts.push("remainder: true");
    else if (c.range) parts.push("range: [" + num(c.range[0]) + ", " + num(c.range[1]) + "]");
    else if (c.at_most != null) parts.push("at_most: " + num(c.at_most));
    else parts.push("pct: " + num(c.pct, 100));
    return "      - { " + parts.join(", ") + " }";
  }

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

    document.querySelectorAll("#ingredients .ingredient").forEach(function (card) {
      var nm = card.querySelector(".ing-name").value.trim();
      if (!nm) return;
      var dose = num(card.querySelector(".ing-dose").value, 0);
      lines.push("  - name: " + yq(nm));
      lines.push("    dose_pct: " + dose);

      if (card._composition) {                       // запазен състав от даташийта
        lines.push("    composition:");
        card._composition.forEach(function (c) { lines.push(compLine(c)); });
        return;
      }
      var fragEl = card.querySelector(".ing-frag");
      if (fragEl && fragEl.checked) {                // аромат + алергени
        lines.push("    is_fragrance: true");
        lines.push("    allergens:");
        card.querySelectorAll(".allergen-row").forEach(function (ar) {
          var an = ar.querySelector(".al-name").value.trim();
          if (!an) return;
          lines.push("      - { name: " + yq(an) + ", pct_in_fragrance: " + num(ar.querySelector(".al-pct").value, 0) + " }");
        });
      } else {                                       // обикновена едно-INCI суровина
        var inci = (card.querySelector(".ing-inci").value || "").trim() || nm;
        lines.push("    composition:");
        lines.push("      - { inci_name: " + yq(inci) + ", pct: 100 }");
      }
    });
    return lines.join("\n") + "\n";
  }

  // --- валидиране на дозите преди изчисление ---
  function firstDoseProblem() {
    var cards = document.querySelectorAll("#ingredients .ingredient");
    var named = 0, bad = null;
    cards.forEach(function (card) {
      var nm = card.querySelector(".ing-name").value.trim();
      if (!nm) return;
      named++;
      var d = card.querySelector(".ing-dose");
      if (!isNum(d.value)) { d.classList.add("invalid"); if (!bad) bad = d; }
      else d.classList.remove("invalid");
    });
    if (named === 0) return { kind: "empty" };
    if (bad) return { kind: "dose", el: bad };
    return null;
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

  function focusFirstEmptyDose() {
    var d = document.querySelector("#ingredients .ing-dose.invalid") ||
      Array.prototype.filter.call(document.querySelectorAll("#ingredients .ing-dose"),
        function (x) { return !isNum(x.value); })[0];
    if (d) { d.classList.add("invalid"); d.focus(); }
  }

  // --- добавяне от извлечена чернова ---
  function rmsOf(node) {
    var card = node.closest ? node.closest(".doc-card") : null;
    if (!card) return [];
    try { return JSON.parse(card.getAttribute("data-rms") || "[]"); } catch (e) { return []; }
  }
  function addRms(rms) {
    if (!rms || !rms.length) { toast("Няма какво да добавя"); return; }
    rms.forEach(function (rm) { appendIngredient(normalizeRm(rm)); });
    toast(rms.length === 1 ? "Добавена 1 съставка" : "Добавени " + rms.length + " съставки");
    var box = document.getElementById("ingredients");
    if (box && box.lastElementChild) box.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
    focusFirstEmptyDose();
  }

  // --- инициализация ---
  document.addEventListener("DOMContentLoaded", function () {
    var box = document.getElementById("ingredients");
    if (box) DEMO.forEach(function (d) { box.appendChild(ingredientCard(d)); });

    var add = document.getElementById("add-ingredient");
    if (add) add.addEventListener("click", function () {
      var card = appendIngredient();
      var inp = card && card.querySelector(".ing-name");
      if (inp) inp.focus();
    });
  });

  // махане на „invalid“ щом потребителят започне да пише доза
  document.body.addEventListener("input", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("ing-dose"))
      e.target.classList.remove("invalid");
  });

  // делегиране на бутоните „Добави“ / „Добави всички“ (вмъкнати чрез fetch)
  document.body.addEventListener("click", function (e) {
    var all = e.target.closest ? e.target.closest("[data-add-all]") : null;
    if (all) { addRms(rmsOf(all)); return; }
    var one = e.target.closest ? e.target.closest("[data-add-one]") : null;
    if (one) {
      var rms = rmsOf(one);
      var i = parseInt(one.getAttribute("data-index"), 10) || 0;
      if (rms[i]) addRms([rms[i]]);
      return;
    }
    // копиране в клипборда
    var copy = e.target.closest ? e.target.closest("[data-copy]") : null;
    if (copy) {
      var src = document.querySelector(copy.getAttribute("data-copy"));
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
    }
  });

  // ---------- качване на документи: мулти-файл + drag&drop + fetch ----------
  var selectedFiles = [];

  function fmtSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return Math.round(b / 1024) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function renderFileList() {
    var ul = document.getElementById("filelist");
    if (!ul) return;
    ul.innerHTML = "";
    selectedFiles.forEach(function (f, idx) {
      var li = el("li", { class: "file-chip" });
      li.appendChild(el("span", { class: "fc-name", title: escAttr(f.name) }, escHtml(f.name)));
      li.appendChild(el("span", { class: "fc-size" }, fmtSize(f.size)));
      var x = el("button", { type: "button", class: "icon-btn", "aria-label": "Премахни файла" }, SVG_TRASH);
      x.addEventListener("click", function () { selectedFiles.splice(idx, 1); renderFileList(); });
      li.appendChild(x);
      ul.appendChild(li);
    });
  }
  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList || [], function (f) {
      var dup = selectedFiles.some(function (g) { return g.name === f.name && g.size === f.size; });
      if (!dup) selectedFiles.push(f);
    });
    renderFileList();
  }
  function setExtracting(on) {
    var btn = document.getElementById("extract-btn");
    var sp = document.getElementById("spin2");
    if (btn) btn.disabled = on;
    if (sp) sp.hidden = !on;
  }
  function runExtract() {
    var draft = document.getElementById("draft");
    if (!selectedFiles.length) { toast("Избери поне един файл"); return; }
    var fd = new FormData();
    selectedFiles.forEach(function (f) { fd.append("files", f, f.name); });
    var t = document.getElementById("ex-type"), o = document.getElementById("ex-ocr");
    fd.append("type", t ? t.value : "auto");
    fd.append("ocr", o ? o.value : "auto");
    setExtracting(true);
    if (draft) draft.innerHTML = '<p class="muted">Чета документите…</p>';
    fetch("/extract", { method: "POST", body: fd })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (html) {
        if (!draft) return;
        draft.innerHTML = html;
        draft.scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
      .catch(function (err) {
        if (draft) draft.innerHTML = '<div class="alarms err-box" role="alert">' +
          '<strong>Възникна проблем при качването</strong>' +
          '<p>Опитай пак. Ако продължава — провери връзката или размера на файловете (' +
          escHtml(err.message) + ").</p></div>";
      })
      .finally(function () { setExtracting(false); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var dz = document.getElementById("dropzone");
    var input = document.getElementById("file-input");
    if (dz && input) {
      dz.addEventListener("click", function () { input.click(); });
      dz.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
      });
      input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
      ["dragenter", "dragover"].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); });
      });
      dz.addEventListener("drop", function (e) {
        if (e.dataTransfer) addFiles(e.dataTransfer.files);
      });
    }
    var btn = document.getElementById("extract-btn");
    if (btn) btn.addEventListener("click", runExtract);
  });

  // Преди заявката: валидирай дозите и генерирай YAML от формата.
  document.body.addEventListener("htmx:configRequest", function (e) {
    if (!(e.detail.elt && e.detail.elt.id === "formula-form")) return;
    var adv = document.querySelector("#formula-form .advanced");
    if (adv && adv.open) return;  // разширен режим → използва се ръчният YAML

    var prob = firstDoseProblem();
    if (prob) {
      e.preventDefault();
      if (prob.kind === "empty") toast("Добави поне една съставка");
      else { toast("Въведи доза за всяка съставка"); if (prob.el) prob.el.focus(); }
      return;
    }
    var y = buildYaml();
    var ta = document.getElementById("yaml");
    if (ta) ta.value = y;
    e.detail.parameters["formula"] = y;
  });
})();
