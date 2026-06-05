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

  // --- добавяне / прикачване от извлечена чернова ---
  // Документ може да е НОВА съставка ИЛИ да допълни вече добавена (без дубликат).
  var ROW_SEQ = 0;
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }

  // Чете жив ред от формата обратно в модел (огледало на ingredientCard).
  function readCard(card) {
    var name = (card.querySelector(".ing-name") || {}).value || "";
    var dose = (card.querySelector(".ing-dose") || {}).value || "";
    if (card._composition && card._composition.length) {
      return { name: name.trim(), dose: dose, fragrance: false, inci: "",
        allergens: [], composition: card._composition };
    }
    var frag = card.querySelector(".ing-frag");
    if (frag && frag.checked) {
      var als = [];
      card.querySelectorAll(".allergen-row").forEach(function (ar) {
        var an = ((ar.querySelector(".al-name") || {}).value || "").trim();
        if (!an) return;
        als.push({ name: an, pct: (ar.querySelector(".al-pct") || {}).value || "" });
      });
      return { name: name.trim(), dose: dose, fragrance: true, inci: "",
        allergens: als, composition: null };
    }
    var inci = ((card.querySelector(".ing-inci") || {}).value || "").trim();
    return { name: name.trim(), dose: dose, fragrance: false, inci: inci,
      allergens: [], composition: null };
  }

  function payloadType(m) {
    if (m.composition && m.composition.length) return "rich";
    if (m.fragrance) return "frag";
    if (m.inci && m.inci.trim()) return "simple";
    return "empty";
  }
  function modelInci(m) {
    if (m.composition && m.composition.length) return m.composition[0].inci_name || "";
    return m.inci || "";
  }
  function compSummary(m) {
    return (m.composition || []).map(function (c) { return c.inci_name; }).join(", ");
  }
  function alSummary(m) {
    return (m.allergens || []).map(function (a) { return a.name; }).filter(Boolean).join(", ");
  }
  function payloadSummary(m) {
    var t = payloadType(m);
    if (t === "rich") return compSummary(m);
    if (t === "frag") return "аромат · " + (m.allergens || []).length + " алерген(а)";
    if (t === "simple") return m.inci;
    return "—";
  }
  function setPayload(target, src) {  // пренася регулаторните данни, не име/доза
    target.inci = src.inci || "";
    target.composition = (src.composition && src.composition.length) ? src.composition : null;
    target.fragrance = !!src.fragrance;
    target.allergens = src.allergens || [];
  }
  function clone(m) { return JSON.parse(JSON.stringify(m)); }

  // Слива документ в съществуващ ред НА НИВО МОДЕЛ; връща {model, conflicts}.
  // Името и дозата на реда се ПАЗЯТ; документът допълва само INCI/състав/алергени.
  function computeMerge(cur, doc, choices) {
    choices = choices || {};
    var merged = clone(cur), conflicts = [];
    if (!merged.name && doc.name) merged.name = doc.name;       // запълни само ако е празно
    if (!isNum(merged.dose) && isNum(doc.dose)) merged.dose = doc.dose;

    var ct = payloadType(cur), dt = payloadType(doc);
    if (dt === "empty") return { model: merged, conflicts: conflicts };
    if (ct === "empty") { setPayload(merged, doc); return { model: merged, conflicts: conflicts }; }

    function decide(key, label, curv, docv) {            // конфликт → запази / замени
      conflicts.push({ key: key, label: label, current: curv, document: docv });
      if (choices[key] === "replace") setPayload(merged, doc);
    }
    if (ct === dt) {
      if (ct === "simple" && norm(cur.inci) !== norm(doc.inci))
        decide("inci", "INCI име", cur.inci, doc.inci);
      else if (ct === "rich" && JSON.stringify(cur.composition) !== JSON.stringify(doc.composition))
        decide("comp", "Състав (от даташийт)", compSummary(cur), compSummary(doc));
      else if (ct === "frag") {
        if (!(cur.allergens || []).length) merged.allergens = doc.allergens || [];  // празно → допълни
        else if (JSON.stringify(cur.allergens) !== JSON.stringify(doc.allergens))
          decide("al", "Алергени", alSummary(cur), alSummary(doc));
      }
    } else {
      decide("kind", "Данни за съставката", payloadSummary(cur), payloadSummary(doc));
    }
    return { model: merged, conflicts: conflicts };
  }

  function replaceCard(oldCard, model) {
    var fresh = ingredientCard(model);
    oldCard.parentNode.replaceChild(fresh, oldCard);
    return fresh;
  }
  function finishAttach(card, model) {
    var fresh = replaceCard(card, model);
    toast("Допълнена съставка: " + (model.name || ""));
    fresh.scrollIntoView({ behavior: "smooth", block: "center" });
    focusFirstEmptyDose();
  }
  function attachToCard(card, rm, host) {
    var cur = readCard(card), doc = normalizeRm(rm);
    var r = computeMerge(cur, doc, {});
    if (!r.conflicts.length) { finishAttach(card, r.model); return; }
    if (!host) { finishAttach(card, r.model); return; }   // няма къде да питам → пази текущото
    host.hidden = false;
    var rows = r.conflicts.map(function (c) {
      return '<div class="cf-row"><div class="cf-label">' + escHtml(c.label) + '</div>' +
        '<label class="cf-opt"><input type="radio" name="cf-' + c.key + '" value="keep" checked> ' +
        'Запази: <span>' + escHtml(c.current || "—") + '</span></label>' +
        '<label class="cf-opt"><input type="radio" name="cf-' + c.key + '" value="replace"> ' +
        'От документа: <span>' + escHtml(c.document || "—") + '</span></label></div>';
    }).join("");
    host.innerHTML = '<div class="cf-panel"><strong>Тази съставка вече има данни — избери какво да остане:</strong>' +
      rows + '<button type="button" class="btn-primary small cf-apply">Приложи</button></div>';
    host.querySelector(".cf-apply").addEventListener("click", function () {
      var choices = {};
      r.conflicts.forEach(function (c) {
        var sel = host.querySelector('input[name="cf-' + c.key + '"]:checked');
        choices[c.key] = sel ? sel.value : "keep";
      });
      var model = computeMerge(cur, doc, choices).model;
      host.hidden = true; host.innerHTML = "";
      finishAttach(card, model);
    });
  }

  // Auto-match: ред с еднакво (нормализирано) INCI или име. Различни езици
  // (Бадемово масло ↔ Almond Oil) няма да съвпаднат → дефолт „нова“, ползвателят избира.
  function matchExistingRow(rm) {
    var m = normalizeRm(rm), dn = norm(m.name), di = norm(modelInci(m)), found = null;
    document.querySelectorAll("#ingredients .ingredient").forEach(function (card) {
      if (found) return;
      var cm = readCard(card), cn = norm(cm.name), ci = norm(modelInci(cm));
      if ((di && ci && di === ci) || (dn && cn && dn === cn)) found = card;
    });
    return found;
  }

  // Пълни „Към“ селектите от ЖИВИТЕ редове; пази избора на ползвателя.
  function populateDestinations() {
    document.querySelectorAll("#ingredients .ingredient").forEach(function (card) {
      if (!card.getAttribute("data-row-id")) card.setAttribute("data-row-id", "r" + (ROW_SEQ++));
    });
    var ids = {};
    var labels = [];
    document.querySelectorAll("#ingredients .ingredient").forEach(function (card) {
      var cm = readCard(card), id = card.getAttribute("data-row-id");
      var label = cm.name || "(без име)";
      var inci = modelInci(cm); if (inci) label += " · " + inci;
      ids[id] = true; labels.push({ id: id, label: label });
    });
    document.querySelectorAll(".doc-card .di-dest").forEach(function (sel) {
      var docCard = sel.closest(".doc-card"), rms = [];
      try { rms = JSON.parse(docCard.getAttribute("data-rms") || "[]"); } catch (e) {}
      var rm = rms[parseInt(sel.getAttribute("data-index"), 10) || 0];
      var match = rm ? matchExistingRow(rm) : null;
      var matchId = match ? match.getAttribute("data-row-id") : "";
      var desired = (sel.value && ids[sel.value]) ? sel.value : (matchId || "new");
      var opts = ['<option value="new"' + (desired === "new" ? " selected" : "") + '>➕ Нова съставка</option>'];
      labels.forEach(function (o) {
        opts.push('<option value="' + o.id + '"' + (desired === o.id ? " selected" : "") +
          '>' + escHtml(o.label) + '</option>');
      });
      sel.innerHTML = opts.join("");
    });
  }

  // Прилага един извлечен елемент към избраната дестинация.
  function applyItem(docCard, idx) {
    var rms = [];
    try { rms = JSON.parse(docCard.getAttribute("data-rms") || "[]"); } catch (e) {}
    var rm = rms[idx];
    if (!rm) return null;
    var sel = docCard.querySelector('.di-dest[data-index="' + idx + '"]');
    var dest = sel ? sel.value : "new";
    if (dest && dest !== "new") {
      var card = document.querySelector('#ingredients .ingredient[data-row-id="' + dest + '"]');
      if (card) {
        var host = docCard.querySelector('.di-conflicts[data-index="' + idx + '"]');
        attachToCard(card, rm, host);
        return "attach";
      }
    }
    appendIngredient(normalizeRm(rm));     // нова съставка (или резерв, ако редът липсва)
    return "new";
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

  // „Към“ селектите се опресняват при отваряне, за да отразяват текущите редове
  document.body.addEventListener("mousedown", function (e) {
    if (e.target && e.target.closest && e.target.closest(".di-dest")) populateDestinations();
  });

  // делегиране на бутоните „Добави“ / „Добави всички“ (вмъкнати чрез fetch)
  document.body.addEventListener("click", function (e) {
    var all = e.target.closest ? e.target.closest("[data-add-all]") : null;
    if (all) {
      var docAll = all.closest(".doc-card"), rmsAll = [];
      try { rmsAll = JSON.parse(docAll.getAttribute("data-rms") || "[]"); } catch (err) {}
      var added = 0;
      rmsAll.forEach(function (_, i) { if (applyItem(docAll, i) === "new") added++; });
      if (added) toast(added === 1 ? "Добавена 1 съставка" : "Добавени " + added + " съставки");
      focusFirstEmptyDose();
      return;
    }
    var one = e.target.closest ? e.target.closest("[data-add-one]") : null;
    if (one) {
      var idx = parseInt(one.getAttribute("data-index"), 10) || 0;
      if (applyItem(one.closest(".doc-card"), idx) === "new") {
        toast("Добавена 1 съставка");
        focusFirstEmptyDose();
      }
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
        populateDestinations();   // напълни „Към“ селектите от текущата формула
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
