/* Форма → YAML за енджина + извличане от документи + дребни UX подобрения.
   Формата е само удобство за въвеждане: тя генерира точно онзи YAML, който
   енджинът вече приема, така че бекендът и детерминизмът остават непокътнати.
   Числата от извличане са ПРЕДЛОЖЕНИЕ — проверяват се от човек. */
(function () {
  "use strict";

  var SVG_TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

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

  // --- единен регистър за INCI имена (детерминистично; базово, AI дава точната форма) ---
  // Само УЕДНАКВЯВА изцяло-главни/изцяло-малки имена към Title Case; имена, които
  // вече са със смесен регистър (вкл. канонични от AI, напр. „alpha-Isomethyl
  // Ionone“) се оставят непокътнати. Така „HELIANTHUS ANNUUS SEED OIL“ се изравнява
  // с „Helianthus Annuus Seed Oil“ (и се слива в енджина), без да разваляме нищо.
  var INCI_UP = { peg: 1, ppg: 1, pvp: 1, vp: 1, va: 1, sd: 1, mea: 1, dea: 1,
    tea: 1, edta: 1, bht: 1, bha: 1, tbhq: 1, pca: 1, ci: 1, pg: 1 };
  function titleToken(tok) {
    if (!tok) return tok;
    var low = tok.toLowerCase();
    if (INCI_UP[low]) return tok.toUpperCase();          // PEG, CI, BHT…
    if (/^[a-z]+-\d+$/i.test(tok)) {                     // PEG-40, Steareth-2
      var p = tok.split("-");
      var head = INCI_UP[p[0].toLowerCase()] ? p[0].toUpperCase()
        : p[0].charAt(0).toUpperCase() + p[0].slice(1).toLowerCase();
      return head + "-" + p[1];
    }
    if (tok.indexOf("-") > 0) return tok.split("-").map(titleToken).join("-");
    if (/\d/.test(tok)) return tok;                      // „77491“, числа → както са
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }
  function inciCase(name) {
    var s = String(name == null ? "" : name).trim().replace(/\s+/g, " ");
    if (!s) return s;
    var hasLower = /[a-zа-яё]/.test(s), hasUpper = /[A-ZА-ЯЁ]/.test(s);
    if (hasLower && hasUpper) return s;                  // вече смесен регистър → не пипай
    return s.split(" ").map(titleToken).join(" ");
  }

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

  // Един кандидат-съставка от даташийт (за многосъставни суровини). Когато е
  // предложен (proposed), е чернова: маркиран, с „Потвърди“, и не влиза в YAML.
  function constituentRow(c, proposed) {
    var row = el("div", { class: "constituent-row" + (proposed ? " proposed" : ""), role: "listitem" });
    if (proposed) row.setAttribute("data-proposed", "1");
    row._spec = c;  // запазваме количествения спец (pct/range/at_most/remainder/cas)
    row.appendChild(el("label", { class: "mini grow" },
      'INCI<input type="text" class="cst-name" value="' + escAttr(c.inci_name) + '">'));
    row.appendChild(el("span", { class: "cst-amt" }, escHtml(amountLabel(c))));
    if (proposed) row.appendChild(confirmBtn());
    var del = el("button", { type: "button", class: "icon-btn", "aria-label": "Премахни съставката" }, SVG_TRASH);
    del.addEventListener("click", function () {
      var card = row.closest(".ingredient"); row.remove(); syncProposed(card); syncIncomplete(card);
    });
    row.appendChild(del);
    return row;
  }
  // Чете ЖИВИТЕ кандидат-редове обратно в спецификации (за YAML/сливане).
  function readConstituents(card) {
    var rows = card.querySelectorAll(".constituent-row");
    if (!rows.length) return null;
    return Array.prototype.map.call(rows, function (row) {
      var spec = row._spec || {}, out = { inci_name: (row.querySelector(".cst-name").value || "").trim() };
      if (spec.cas) out.cas = spec.cas;
      if (spec.remainder) out.remainder = true;
      else if (spec.range) out.range = spec.range;
      else if (spec.at_most != null) out.at_most = spec.at_most;
      else out.pct = (spec.pct != null ? spec.pct : 100);
      return out;
    });
  }

  function allergenRow(a, proposed) {
    var row = el("div", { class: "allergen-row" + (proposed ? " proposed" : ""), role: "listitem" });
    if (proposed) row.setAttribute("data-proposed", "1");
    row.appendChild(el("label", { class: "mini" }, 'Алерген<input type="text" class="al-name" value="' +
      escAttr(a && a.name) + '" placeholder="напр. Limonene">'));
    row.appendChild(el("label", { class: "mini" }, '% в аромата<input type="number" class="al-pct" step="any" min="0" inputmode="decimal" value="' +
      escAttr(a && a.pct) + '">'));
    if (proposed) row.appendChild(confirmBtn());
    var del = el("button", { type: "button", class: "icon-btn", "aria-label": "Премахни алергена" }, SVG_TRASH);
    del.addEventListener("click", function () { var card = row.closest(".ingredient"); row.remove(); syncProposed(card); syncIncomplete(card); });
    row.appendChild(del);
    return row;
  }

  function ingredientCard(data) {
    data = data || { name: "", dose: "", inci: "", fragrance: false, allergens: [], composition: null };
    var rich = !!(data.composition && data.composition.length);
    var proposed = !!data.proposed;   // дошло от извличане → чернова до потвърждение
    // Рисково = алергени: те се потвърждават дори когато съставът се авто-приема.
    var alProposed = (data.allergensProposed != null) ? !!data.allergensProposed : proposed;
    var card = el("div", { class: "ingredient", role: "listitem" });

    card.appendChild(el("label", { class: "field grow" }, 'Съставка<input type="text" class="ing-name" value="' +
      escAttr(data.name) + '" placeholder="напр. Sweet Almond Oil" autocomplete="off">'));

    var doseEmpty = !isNum(data.dose);
    card.appendChild(el("label", { class: "field narrow" }, 'Доза %<input type="number" class="ing-dose' +
      (doseEmpty && (data.name) ? " invalid" : "") + '" step="any" min="0" inputmode="decimal" value="' +
      escAttr(data.dose) + '">'));

    // Прост едно-INCI вход (за ръчни и едносъставни извлечени суровини).
    var inciProposed = proposed && !rich && !!data.inci;
    var inciLabel = el("label", { class: "field grow ing-inci-wrap" },
      'INCI име<input type="text" class="ing-inci' + (inciProposed ? " proposed" : "") + '"' +
      (inciProposed ? ' data-proposed="1"' : "") + ' value="' + escAttr(data.inci) +
      '" placeholder="напр. Prunus Amygdalus Dulcis Oil" autocomplete="off">');
    if (inciProposed) inciLabel.appendChild(confirmBtn());
    card.appendChild(inciLabel);

    // Многосъставен състав от даташийт → кандидат-редове (всеки се потвърждава
    // или маха поотделно); непотвърдените НЕ влизат в изчислението.
    if (rich) {
      inciLabel.style.display = "none";
      var wrap = el("div", { class: "field grow comp-wrap" });
      wrap.appendChild(el("p", { class: "comp-head" }, proposed
        ? "Компоненти на съставката (AI чернова) — потвърди или премахни всеки спрямо източника:"
        : "Състав от даташийта:"));
      var clist = el("div", { class: "constituents", role: "list" });
      data.composition.forEach(function (c) { clist.appendChild(constituentRow(c, proposed)); });
      wrap.appendChild(clist);
      card.appendChild(wrap);
    }

    var del = el("button", { type: "button", class: "icon-btn row-del", "aria-label": "Премахни съставката" }, SVG_TRASH);
    del.addEventListener("click", function () { card.remove(); syncEmptyState(); });
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
      // „Потвърди всички“ — за чиста IFRA справка, потвърждаваш целия списък наведнъж.
      // Всеки алерген пак има и собствено „Потвърди“. Показва се само при ≥2 чернови.
      alBlock.appendChild(el("button", { type: "button", class: "btn-ghost small confirm-all-al",
        hidden: "hidden", title: "Потвърди всички извлечени алергени наведнъж (за чиста IFRA справка)" },
        "Потвърди всички"));
      alBlock.appendChild(allergens);
      alBlock.appendChild(addAl);
      fragWrap.appendChild(alBlock);
      card.appendChild(fragWrap);

      var togInput = tog.querySelector("input");
      function syncFrag() { card.classList.toggle("is-fragrance", togInput.checked); syncIncomplete(card); }
      togInput.addEventListener("change", syncFrag);
      (data.allergens || []).forEach(function (a) { allergens.appendChild(allergenRow(a, alProposed)); });
      if (data.fragrance && (!data.allergens || !data.allergens.length)) allergens.appendChild(allergenRow());
      syncFrag();
    }

    if (data.doc) {       // провенанс: кой документ е попълнил тази суровина
      card.setAttribute("data-doc", data.doc);
      card.appendChild(el("p", { class: "row-doc" }, "📎 от: " + escHtml(data.doc)));
    }
    syncProposed(card);   // вдига черновата лента, ако има непотвърдени стойности
    syncIncomplete(card); // маркира ред без INCI (рецепта без съответен документ)
    return card;
  }

  function appendIngredient(data, opts) {
    var box = document.getElementById("ingredients");
    if (!box) return null;
    var card = ingredientCard(data);
    box.appendChild(card);
    syncEmptyState();
    return card;
  }

  // Подсказка в празния списък със съставки (стартът вече е без демо данни).
  function syncEmptyState() {
    var box = document.getElementById("ingredients");
    if (!box) return;
    var has = !!box.querySelector(".ingredient");
    var hint = box.querySelector(".ingredients-empty");
    if (!has && !hint) {
      box.appendChild(el("p", { class: "ingredients-empty" },
        "Все още няма съставки — качи рецептата по-долу или натисни „Добави съставка“."));
    } else if (has && hint) {
      hint.remove();
    }
  }

  // --- карантина на ИЗВЛЕЧЕНИ СТОЙНОСТИ (Член 10: човек потвърждава всяка) ---
  // Всяка стойност от извличане е ПРЕДЛОЖЕНИЕ (data-proposed): показва се
  // маркирана като чернова, НЕ влиза в YAML-а и блокира /compute, докато човек
  // не я потвърди (бутон „Потвърди“) или не я редактира/премахне спрямо източника.
  function confirmBtn() {
    return el("button", { type: "button", class: "btn-ghost small confirm-val",
      title: "Потвърди тази стойност спрямо източника" }, "Потвърди");
  }
  // Обновява черновата лента според това дали в реда още има непотвърдени стойности.
  function syncProposed(card) {
    if (!card) return;
    var has = !!card.querySelector("[data-proposed]");
    card.classList.toggle("unverified", has);
    var badge = card.querySelector(".unverified-badge");
    if (has && !badge) {
      card.insertBefore(el("div", { class: "unverified-badge" },
        '<span class="uv-tag">AI чернова — потвърди всяка стойност спрямо източника</span>'),
        card.firstChild);
    } else if (!has && badge) {
      badge.remove();
    }
    syncAllergenBulk(card);
  }
  // „Потвърди всички“ за алергени се показва само при ≥2 непотвърдени (AI) алергена.
  function syncAllergenBulk(card) {
    var btn = card.querySelector(".confirm-all-al");
    if (!btn) return;
    btn.hidden = card.querySelectorAll(".allergens .allergen-row[data-proposed]").length < 2;
  }

  // Ред е „непълен“, ако има име, но НЯМА разпознат INCI/състав (и не е аромат).
  // Така рецепта без съответен документ не влиза тихо в изчислението с името на
  // суровината вместо INCI (точно това разваляше генерирания INCI списък преди).
  function rowResolved(card) {
    if (readConstituents(card)) return true;             // многосъставен състав
    var frag = card.querySelector(".ing-frag");
    if (frag && frag.checked) return true;               // аромат (носи алергени)
    var inci = (card.querySelector(".ing-inci") || {}).value || "";
    return !!inci.trim();
  }
  function syncIncomplete(card) {
    if (!card) return;
    var nameEl = card.querySelector(".ing-name");
    var named = nameEl && nameEl.value.trim();
    var bad = !!named && !rowResolved(card);
    card.classList.toggle("incomplete", bad);
    var hint = card.querySelector(".incomplete-hint");
    if (bad && !hint) {
      card.appendChild(el("p", { class: "incomplete-hint" },
        "⚠ няма INCI — добави документ за тази суровина или въведи INCI ръчно"));
    } else if (!bad && hint) {
      hint.remove();
    }
  }
  // Сваля „предложение“ от един елемент (вход, съставка или алерген) и маха бутона.
  function confirmValue(node) {
    if (!node) return;
    node.removeAttribute("data-proposed");
    node.classList.remove("proposed");
    var isRow = node.classList.contains("constituent-row") || node.classList.contains("allergen-row");
    var scope = isRow ? node : ((node.closest && node.closest(".ing-inci-wrap")) || node.parentNode);
    var btn = scope && scope.querySelector(".confirm-val");
    if (btn) btn.remove();
  }

  // --- сериализация форма → YAML ---
  function compLine(c) {
    var parts = ["inci_name: " + yq(inciCase(c.inci_name))];
    if (c.cas) parts.push("cas: " + yq(c.cas));
    if (c.remainder) parts.push("remainder: true");
    else if (c.range) parts.push("range: [" + num(c.range[0]) + ", " + num(c.range[1]) + "]");
    else if (c.at_most != null) parts.push("at_most: " + num(c.at_most));
    else parts.push("pct: " + num(c.pct, 100));
    return "      - { " + parts.join(", ") + " }";
  }

  function buildYaml() {
    var name = document.getElementById("p-name").value || "Продукт";
    var type = document.getElementById("p-type").value;   // гарантирано избран от гейта
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

      var comp = readConstituents(card);             // многосъставен състав от даташийт
      var fragEl = card.querySelector(".ing-frag");
      var isFrag = !!(fragEl && fragEl.checked);
      var inciEl = card.querySelector(".ing-inci");
      var inci = ((inciEl && inciEl.value) || "").trim();

      // Ред без разпознат INCI/състав НЕ се записва (иначе името на суровината би
      // изтекло като INCI, а и енджинът не приема суровина без състав). Такъв ред
      // е „непълен“ и вече блокира изчислението (виж htmx:configRequest).
      if (!comp && !isFrag && !inci) return;

      var dose = num(card.querySelector(".ing-dose").value, 0);
      lines.push("  - name: " + yq(nm));
      lines.push("    dose_pct: " + dose);

      if (comp) {
        lines.push("    composition:");
        comp.forEach(function (c) { lines.push(compLine(c)); });
      } else if (isFrag) {                           // аромат + алергени
        lines.push("    is_fragrance: true");
        lines.push("    allergens:");
        card.querySelectorAll(".allergen-row").forEach(function (ar) {
          var an = ar.querySelector(".al-name").value.trim();
          if (!an) return;
          lines.push("      - { name: " + yq(inciCase(an)) + ", pct_in_fragrance: " + num(ar.querySelector(".al-pct").value, 0) + " }");
        });
      } else {                                       // обикновена едно-INCI суровина
        lines.push("    composition:");
        lines.push("      - { inci_name: " + yq(inciCase(inci)) + ", pct: 100 }");
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
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }

  // Чете жив ред от формата обратно в модел (огледало на ingredientCard).
  function readCard(card) {
    var name = (card.querySelector(".ing-name") || {}).value || "";
    var dose = (card.querySelector(".ing-dose") || {}).value || "";
    var comp = readConstituents(card);
    if (comp) {
      return { name: name.trim(), dose: dose, fragrance: false, inci: "",
        allergens: [], composition: comp };
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
  // --- прилика по име: масово съпоставяне на TDS файл към съществуващ ред ---
  // Имената на даташийт-файлове носят шум („Olcopher TDS“, „…_datasheet_v2“).
  // matchKey маха тези думи/пунктуация, за да остане идентичността на суровината.
  var DS_STOP = /\b(tds|msds|sds|coa|pds|datasheet|data\s*sheet|specification|spec|sheet|даташийт|спецификация|сертификат|certificate|final|copy|rev|ver|version|v)\b/gi;
  function matchKey(s) {
    return norm(s)
      .replace(/\([^)]*\)/g, " ")          // премахни пояснения в скоби, напр. „(пример)“
      .replace(DS_STOP, " ")               // премахни думи от имена на даташийти
      .replace(/[^0-9a-zа-яё ]+/gi, " ")   // пунктуация/разделители → интервал
      .replace(/\s+/g, " ").trim();
  }
  function keyTokens(s) { return matchKey(s).split(" ").filter(Boolean); }
  // 0..1: 1 = еднакъв ключ; иначе дял на общите думи спрямо по-късото име.
  function nameSimilarity(a, b) {
    var ka = matchKey(a), kb = matchKey(b);
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    var ta = keyTokens(a), tb = keyTokens(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {}; tb.forEach(function (t) { setB[t] = 1; });
    var hit = 0; ta.forEach(function (t) { if (setB[t]) hit++; });
    return hit / Math.min(ta.length, tb.length);
  }
  var MATCH_MIN = 0.6;   // праг: под него → „нова съставка“, ползвателят коригира

  // Съпоставя извлечен файл към НАЙ-близкия ред: точно INCI/име първо, иначе
  // прилика по име (файл „Olcopher TDS“ ↔ ред „Olcopher“). Връща реда или null.
  function matchExistingRow(rm) {
    var m = normalizeRm(rm), dn = norm(m.name), di = norm(modelInci(m));
    var mi = modelInci(m), best = null, bestScore = 0;
    document.querySelectorAll("#ingredients .ingredient").forEach(function (card) {
      var cm = readCard(card), cn = norm(cm.name), ci = norm(modelInci(cm));
      if ((di && ci && di === ci) || (dn && cn && dn === cn)) {       // точно съвпадение
        if (bestScore < 1) { best = card; bestScore = 1; }
        return;
      }
      var s = nameSimilarity(m.name, cm.name);                        // прилика по име
      if (mi && ci) s = Math.max(s, nameSimilarity(mi, modelInci(cm)));// или по INCI
      if (s > bestScore) { best = card; bestScore = s; }
    });
    return bestScore >= MATCH_MIN ? best : null;
  }

  // --- консолидиране на качения КОМПЛЕКТ (документ-първо, без ръчно мапване) ---
  // Един комплект = една рецепта + по един подкрепящ документ на суровина (+ аромат).
  // Рецептата дава редовете и дозите; всеки подкрепящ документ се съпоставя по име
  // и допълва INCI/състав/алергени към своя ред. Съставът се АВТО-ПРИЕМА; алергените
  // (рисково) остават за потвърждение. Виж docs/UX_INTAKE_SPEC.md §2.
  function collectDocs() {
    var out = [];
    document.querySelectorAll("#draft .intake-doc").forEach(function (li) {
      var rms = [];
      try { rms = JSON.parse(li.getAttribute("data-rms") || "[]"); } catch (e) {}
      out.push({
        el: li,
        role: li.getAttribute("data-role") || "ingredient",
        filename: li.getAttribute("data-filename") || "",
        error: !!li.getAttribute("data-error"),
        rms: rms
      });
    });
    return out;
  }
  function setDocStatus(li, text, cls) {
    var s = li.querySelector(".idoc-status");
    if (s) { s.textContent = text; s.className = "idoc-status " + (cls || ""); }
  }
  function renderIntakeFlags(flags) {
    var box = document.querySelector("#draft .intake-flags");
    if (!box) return;
    if (!flags.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = '<strong>Провери тези несъответствия преди изчисление:</strong><ul>' +
      flags.map(function (f) { return "<li>" + escHtml(f) + "</li>"; }).join("") + "</ul>";
  }

  // Допълва съществуващ ред от документ: ПАЗИ име/доза, пълни само INCI/състав/
  // алергени. Съставът се приема (proposed=false); алергените се маркират за потвърждение.
  function autoAttach(card, rm, filename) {
    var cur = readCard(card), doc = normalizeRm(rm);
    var model = computeMerge(cur, doc, {}).model;   // {} → запазва текущото, пълни празните
    model.proposed = false;
    model.allergensProposed = !!model.fragrance && !!(model.allergens && model.allergens.length);
    if (filename) model.doc = filename;
    return replaceCard(card, model);
  }

  // INCI/алергени, които документът удостоверява — вход за AI съпоставянето.
  function docInciList(d) {
    var inci = [], al = [];
    (d.rms || []).forEach(function (rm) {
      if (rm.is_fragrance) (rm.allergens || []).forEach(function (a) { if (a && a.name) al.push(a.name); });
      (rm.composition || []).forEach(function (c) { if (c && c.inci_name) inci.push(c.inci_name); });
    });
    return { inci: inci, allergens: al };
  }
  // Живите редове на формата като {i, name} (вход за съпоставянето; редът = индекс).
  function rowList() {
    var rows = [];
    document.querySelectorAll("#ingredients .ingredient").forEach(function (card, i) {
      rows.push({ i: i, name: readCard(card).name || "" });
    });
    return rows;
  }
  // Допълва нов ред от документ, който не е съпоставен към съществуващ.
  function addDocAsNewRow(rm, filename) {
    var model = normalizeRm(rm);
    model.proposed = false;
    model.allergensProposed = !!model.fragrance;   // нов ароматен ред → потвърди алергените
    model.doc = filename;
    appendIngredient(model);
  }

  var MATCH_HIGH = 0.6;   // под този доверителен праг → допълваме, но маркираме за проверка

  // Прилага AI картата „документ → ред“. matches: [{doc,row,matched,confidence,why}],
  // doc = индекс в supportDocs, row = индекс в #ingredients (или -1).
  function applyMatchMap(supportDocs, matches, flags) {
    var byDoc = {};
    (matches || []).forEach(function (m) { byDoc[m.doc] = m; });
    supportDocs.forEach(function (d, di) {
      var m = byDoc[di];
      var hasMatch = !!(m && m.matched && m.row >= 0);
      var matched = 0, made = 0, rowName = "";
      d.rms.forEach(function (rm) {
        var live = hasMatch ? document.querySelectorAll("#ingredients .ingredient")[m.row] : null;
        if (live) { rowName = readCard(live).name || ""; autoAttach(live, rm, d.filename); matched++; }
        else { addDocAsNewRow(rm, d.filename); made++; }
      });
      if (matched) {
        var pct = (m.confidence != null) ? " (" + Math.round(m.confidence * 100) + "%)" : "";
        var low = (m.confidence != null && m.confidence < MATCH_HIGH);
        setDocStatus(d.el, "→ ред «" + rowName + "»" + pct, low ? "warn" : "ok");
        if (low) flags.push("Провери съответствието: „" + d.filename + "“ → ред «" + rowName + "» (несигурно).");
      } else {
        setDocStatus(d.el, made + " нов(и)", "warn");
        var why = (m && m.why) ? " (" + m.why + ")" : "";
        flags.push("„" + d.filename + "“ — AI не намери съвпадащ ред" + why +
          "; добавен е като нов (провери дозата).");
      }
    });
  }

  // Резервен вариант без ключ: проста евристика по име (ограничена при различни езици).
  function applyHeuristic(supportDocs, flags) {
    supportDocs.forEach(function (d) {
      var matched = 0, made = 0, rowName = "";
      d.rms.forEach(function (rm) {
        var card = matchExistingRow(rm);
        if (card) { rowName = readCard(card).name || ""; autoAttach(card, rm, d.filename); matched++; }
        else { addDocAsNewRow(rm, d.filename); made++; }
      });
      setDocStatus(d.el, matched ? ("→ ред «" + rowName + "»") : (made + " нов(и)"), matched ? "ok" : "warn");
      if (made && !matched)
        flags.push("„" + d.filename + "“ не съвпадна с ред — добавен е като нов (провери дозата).");
    });
  }

  // INCI имената от живите редове → за AI канонизиране (с препратки към входовете).
  function collectCanonItems() {
    var items = [], refs = [];
    document.querySelectorAll("#ingredients .ingredient").forEach(function (card) {
      var rowName = ((card.querySelector(".ing-name") || {}).value || "").trim();
      var csts = card.querySelectorAll(".constituent-row .cst-name");
      if (csts.length) {
        Array.prototype.forEach.call(csts, function (inp) {
          if (inp.value.trim()) { items.push({ id: refs.length, name: inp.value.trim(), kind: "composition", context: rowName }); refs.push({ el: inp, kind: "composition", card: card }); }
        });
        return;
      }
      var frag = card.querySelector(".ing-frag");
      if (frag && frag.checked) {
        card.querySelectorAll(".allergen-row .al-name").forEach(function (inp) {
          if (inp.value.trim()) { items.push({ id: refs.length, name: inp.value.trim(), kind: "allergen", context: rowName }); refs.push({ el: inp, kind: "allergen", card: card }); }
        });
        return;
      }
      var inci = card.querySelector(".ing-inci");
      if (inci && inci.value.trim()) { items.push({ id: refs.length, name: inci.value.trim(), kind: "composition", context: rowName }); refs.push({ el: inci, kind: "composition", card: card }); }
    });
    return { items: items, refs: refs };
  }

  // Прилага каноничните имена: преименува към INCI; маха не-INCI и не-декларируеми
  // (част от Parfum) вещества. Съставът се авто-приема; алергените остават за потвърждение.
  function applyCanon(refs, results, flags) {
    var changed = 0, dropped = 0, cards = [];
    results.forEach(function (r) {
      var ref = refs[r.id];
      if (!ref) return;
      if (cards.indexOf(ref.card) < 0) cards.push(ref.card);
      var remove = r.drop || (ref.kind === "allergen" && !r.declarable);
      if (remove) {
        var rowEl = ref.el.closest(".constituent-row") || ref.el.closest(".allergen-row");
        if (rowEl) { rowEl.remove(); dropped++; }
        else { ref.el.value = ""; }     // проста едно-INCI стойност за махане → изчисти
        return;
      }
      if (r.canonical && r.canonical !== ref.el.value) { ref.el.value = r.canonical; changed++; }
    });
    cards.forEach(function (c) { syncProposed(c); syncIncomplete(c); });
    if (changed) flags.push("Имената са приведени към INCI (" + changed + ") — провери ги.");
    if (dropped) flags.push("Премахнати " + dropped + " вещества (не са декларируеми алергени / не са INCI; част от Parfum).");
  }

  // Втора AI стъпка след съпоставянето: канонизира имената на живите редове.
  function runCanonicalize(flags) {
    var c = collectCanonItems();
    if (!c.items.length) return Promise.resolve();
    return fetch("/canonicalize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: c.items })
    })
      .then(function (r) { return r.ok ? r.json() : { available: false, items: [] }; })
      .catch(function () { return { available: false, items: [] }; })
      .then(function (res) {
        if (res && res.available) applyCanon(c.refs, res.items || [], flags);
        else flags.push("AI нормализация на имената недостъпна — при изчисление се прилага само единен регистър.");
      });
  }

  // Финал: маркирай редовете без INCI, покажи флаговете и фокусирай първата празна доза.
  function finishConsolidation(flags, usableCount) {
    syncEmptyState();
    document.querySelectorAll("#ingredients .ingredient").forEach(syncIncomplete);
    var incompletes = document.querySelectorAll("#ingredients .ingredient.incomplete").length;
    if (incompletes)
      flags.push(incompletes + " ред(а) без INCI — добави документ за тях или въведи INCI ръчно.");
    renderIntakeFlags(flags);
    if (usableCount) toast("Готово — прегледай таблицата и потвърди алергените");
    focusFirstEmptyDose();
  }

  // Документ-първо консолидиране: рецептата дава редовете; всеки подкрепящ документ
  // се съпоставя към своя ред чрез AI (многоезично, по INCI в документа) и го допълва.
  // Връща Promise — извличането изчаква да приключи. Виж docs/UX_INTAKE_SPEC.md §2.
  function consolidateExtract() {
    var docs = collectDocs();
    var usable = docs.filter(function (d) { return !d.error && d.rms.length; });
    var formulaDocs = usable.filter(function (d) { return d.role === "formula"; });
    var supportDocs = usable.filter(function (d) { return d.role !== "formula"; });
    var box = document.getElementById("ingredients");
    var flags = [];

    // 1) Рецепта → скелет от редове (име + доза). Тя е източникът на редовете.
    if (formulaDocs.length && box) {
      box.innerHTML = "";
      formulaDocs.forEach(function (d) {
        d.rms.forEach(function (rm) {
          var m = normalizeRm(rm);
          appendIngredient({ name: m.name, dose: m.dose, inci: "", fragrance: false, allergens: [] });
        });
        setDocStatus(d.el, "рецепта · " + d.rms.length + " реда", "ok");
      });
    }

    if (!supportDocs.length) { finishConsolidation(flags, usable.length); return Promise.resolve(); }

    // 2) Подкрепящи документи → AI съпоставяне към ред (многоезично), после допълване.
    var payload = {
      rows: rowList(),
      docs: supportDocs.map(function (d, j) {
        var x = docInciList(d);
        return { j: j, filename: d.filename, role: d.role, inci: x.inci, allergens: x.allergens };
      })
    };
    return fetch("/match", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.ok ? r.json() : { available: false, matches: [] }; })
      .catch(function () { return { available: false, matches: [] }; })
      .then(function (res) {
        if (res && res.available) {
          flags.push("✅ AI съпоставяне активно" + (res.model ? " (модел: " + res.model + ")" : "") +
            " — провери предложените съответствия.");
          applyMatchMap(supportDocs, res.matches || [], flags);
        } else {
          applyHeuristic(supportDocs, flags);
          flags.push("⚠ AI съпоставяне недостъпно — задай ANTHROPIC_API_KEY за точно " +
            "съпоставяне между езици/търговски имена" + (res && res.note ? " (" + res.note + ")" : "") +
            ". Падам към проста евристика по име.");
        }
        return runCanonicalize(flags);   // втора стъпка: канонизиране на имената
      })
      .then(function () {
        finishConsolidation(flags, usable.length);
      });
  }

  // --- инициализация ---
  document.addEventListener("DOMContentLoaded", function () {
    syncEmptyState();   // празен старт (без демо данни) → подсказка в списъка

    var add = document.getElementById("add-ingredient");
    if (add) add.addEventListener("click", function () {
      var card = appendIngredient();
      var inp = card && card.querySelector(".ing-name");
      if (inp) inp.focus();
    });

    var help = document.getElementById("help-btn");
    if (help) help.addEventListener("click", startTour);
  });

  // махане на „invalid“ щом потребителят започне да пише доза;
  // редакция на предложена стойност = потвърждение спрямо източника
  document.body.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains("ing-dose")) t.classList.remove("invalid");
    if (t.classList.contains("ing-name") || t.classList.contains("ing-inci")) {
      syncIncomplete(t.closest(".ingredient"));   // въведен INCI → редът вече не е „непълен“
    }
    if (t.classList.contains("ing-inci") && t.hasAttribute("data-proposed")) {
      confirmValue(t); syncProposed(t.closest(".ingredient"));
    }
    if (t.classList.contains("cst-name")) {
      var row = t.closest(".constituent-row");
      if (row && row.hasAttribute("data-proposed")) {
        confirmValue(row); syncProposed(t.closest(".ingredient"));
      }
    }
    if (t.classList.contains("al-name") || t.classList.contains("al-pct")) {
      var arow = t.closest(".allergen-row");
      if (arow && arow.hasAttribute("data-proposed")) {
        confirmValue(arow); syncProposed(t.closest(".ingredient"));
      }
    }
  });

  // делегиране на бутоните за потвърждение/копиране (вмъкнати чрез fetch)
  document.body.addEventListener("click", function (e) {
    // „Потвърди“ → сваля предложението от конкретната стойност (INCI вход или съставка)
    var cv = e.target.closest ? e.target.closest(".confirm-val") : null;
    if (cv) {
      var card = cv.closest(".ingredient");
      var container = cv.closest(".constituent-row") || cv.closest(".allergen-row");
      confirmValue(container || card.querySelector(".ing-inci[data-proposed]"));
      syncProposed(card);
      return;
    }

    // „Потвърди всички“ (алергени) → сваля черновата от ВСИЧКИ алергени в реда.
    var cvAll = e.target.closest ? e.target.closest(".confirm-all-al") : null;
    if (cvAll) {
      var alCard = cvAll.closest(".ingredient");
      alCard.querySelectorAll(".allergens .allergen-row[data-proposed]")
        .forEach(function (row) { confirmValue(row); });
      syncProposed(alCard);
      return;
    }

    // „Потвърждавам N аларми“ → разкрива скритите изходи (INCI, CPSR)
    var ack = e.target.closest ? e.target.closest("[data-ack-alarms]") : null;
    if (ack) {
      var res = ack.closest(".result");
      if (res) { var g = res.querySelector(".gated"); if (g) g.hidden = false; }
      var note = ack.closest(".gate-note"); if (note) note.hidden = true;
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
        return consolidateExtract();   // авто: рецепта → редове + AI съпоставяне на документите
      })
      .then(function () {
        // насочваме към бутона „Изчисли“ — плъзване + кратък акцент + подсказка
        var btn = document.querySelector('#formula-form button[type="submit"]');
        if (btn) {
          btn.scrollIntoView({ behavior: "smooth", block: "center" });
          btn.classList.add("cta-pulse");
          setTimeout(function () { btn.classList.remove("cta-pulse"); }, 6000);
        }
        toast("Прегледай таблицата и натисни „Изчисли таблица + INCI“");
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
    if (adv && adv.open) {
      // разширен режим → праща се ръчният YAML, но иска изрично потвърждение,
      // че е прегледан (свободният текст не може да се провери ред по ред).
      var ta = document.getElementById("yaml");
      if (ta && !ta.value.trim()) {       // полето вече е празно по подразбиране
        e.preventDefault();
        toast("Въведи YAML или затвори разширения режим.");
        ta.focus();
        return;
      }
      var ackY = document.getElementById("yaml-ack");
      if (!ackY || !ackY.checked) {
        e.preventDefault();
        toast("Отбележи „Прегледах този YAML ред по ред“ преди изчисление");
        if (ackY) ackY.focus();
      }
      return;
    }

    // Тип на продукта се избира съзнателно (определя прага за алергени).
    var typeEl = document.getElementById("p-type");
    if (typeEl && !typeEl.value) {
      e.preventDefault();
      toast("Избери тип на продукта (остава върху кожата / отмива се)");
      typeEl.focus();
      return;
    }

    var prob = firstDoseProblem();
    if (prob) {
      e.preventDefault();
      if (prob.kind === "empty") toast("Добави поне една съставка");
      else { toast("Въведи доза за всяка съставка"); if (prob.el) prob.el.focus(); }
      return;
    }
    // Коректност: ред без INCI не минава (иначе името на суровината би изтекло
    // като INCI). Рецепта без съответен документ → добави документа или INCI ръчно.
    var inc = document.querySelector('#ingredients .ingredient.incomplete');
    if (inc) {
      e.preventDefault();
      toast("Има ред без INCI — добави документ за тази суровина или въведи INCI ръчно");
      inc.scrollIntoView({ behavior: "smooth", block: "center" });
      var ie = inc.querySelector(".ing-inci"); if (ie) ie.focus();
      return;
    }
    // Карантина само за РИСКОВИТЕ стойности: извлечените алергени се потвърждават
    // спрямо IFRA справката (съставът се авто-приема). Член 10 / docs §0.
    var prop = document.querySelector('#ingredients .allergen-row[data-proposed]');
    if (prop) {
      e.preventDefault();
      toast("Потвърди извлечените алергени (бутон „Потвърди“) спрямо IFRA справката");
      var pcard = prop.closest(".ingredient") || prop;
      pcard.scrollIntoView({ behavior: "smooth", block: "center" });
      var cb = pcard.querySelector(".confirm-val") || pcard.querySelector(".confirm-all-al");
      if (cb) cb.focus();
      return;
    }
    var y = buildYaml();
    var ta = document.getElementById("yaml");
    if (ta) ta.value = y;
    e.detail.parameters["formula"] = y;
  });

  // след изчисление: плъзни до резултата (важно на телефон — резултатът е по-долу)
  document.body.addEventListener("htmx:afterSwap", function (e) {
    if (e.target && e.target.id === "results")
      e.target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- кратко въведение със стъпкови подсказки (еднократно, с пропускане) ----------
  var TOUR = [
    { sel: "#formula-form .field-grid",
      text: "Започни оттук: въведи име на продукта и избери тип (остава върху кожата или отмива се)." },
    { sel: "#dropzone",
      text: "Пусни снимката на рецептата и всички даташийти наведнъж — приложението ги разпознава и попълва състава автоматично." },
    { sel: "#formula-form button[type=\"submit\"]",
      text: "Накрая натисни „Изчисли таблица + INCI“, за да получиш таблицата и INCI списъка." }
  ];
  var tour = { i: 0, ring: null, tip: null, onResize: null };

  function tourKey(e) { if (e.key === "Escape") tourEnd(true); }
  function tourEnd(persist) {
    if (tour.ring) tour.ring.remove();
    if (tour.tip) tour.tip.remove();
    tour.ring = tour.tip = null;
    if (tour.onResize) { window.removeEventListener("resize", tour.onResize); tour.onResize = null; }
    document.removeEventListener("keydown", tourKey);
    if (persist) { try { localStorage.setItem("pif_onboarded", "1"); } catch (e) {} }
  }
  function tourPlace() {
    var step = TOUR[tour.i], t = step && document.querySelector(step.sel);
    if (!t || !tour.ring) return;
    var r = t.getBoundingClientRect(), pad = 6;
    var top = r.top + window.pageYOffset - pad, left = r.left + window.pageXOffset - pad;
    tour.ring.style.top = top + "px"; tour.ring.style.left = left + "px";
    tour.ring.style.width = (r.width + pad * 2) + "px";
    tour.ring.style.height = (r.height + pad * 2) + "px";
    var tip = tour.tip, vw = document.documentElement.clientWidth;
    var below = (r.bottom + 170) < window.innerHeight;
    var tTop = below ? (top + r.height + pad * 2 + 10) : (top - 10 - tip.offsetHeight);
    if (tTop < window.pageYOffset + 8) tTop = window.pageYOffset + 8;
    var tLeft = Math.min(left, window.pageXOffset + vw - tip.offsetWidth - 8);
    if (tLeft < window.pageXOffset + 8) tLeft = window.pageXOffset + 8;
    tip.style.top = tTop + "px"; tip.style.left = tLeft + "px";
  }
  function tourShow(i) {
    if (i < 0) i = 0;
    tour.i = i;
    var step = TOUR[i], t = document.querySelector(step.sel);
    if (!t) { return (i + 1 < TOUR.length) ? tourShow(i + 1) : tourEnd(true); }
    if (!tour.ring) {
      tour.ring = el("div", { class: "tour-ring" });
      tour.tip = el("div", { class: "tour-tip", role: "dialog", "aria-live": "polite" });
      document.body.appendChild(tour.ring);
      document.body.appendChild(tour.tip);
      tour.onResize = tourPlace;
      window.addEventListener("resize", tour.onResize);
      document.addEventListener("keydown", tourKey);
    }
    var last = i === TOUR.length - 1;
    tour.tip.innerHTML =
      '<p class="tour-text">' + escHtml(step.text) + "</p>" +
      '<div class="tour-nav"><span class="tour-count">' + (i + 1) + "/" + TOUR.length + "</span>" +
      '<span class="tour-btns">' +
      (i > 0 ? '<button type="button" class="btn-ghost small" data-tour="back">Назад</button>' : "") +
      '<button type="button" class="btn-primary small" data-tour="' + (last ? "done" : "next") + '">' +
      (last ? "Готово" : "Напред") + "</button></span></div>" +
      '<button type="button" class="tour-skip" data-tour="skip">Пропусни</button>';
    t.scrollIntoView({ behavior: "smooth", block: "center" });
    requestAnimationFrame(tourPlace);   // постави веднага
    setTimeout(tourPlace, 380);         // и пак, след като скролът улегне
  }
  function startTour() { tourEnd(false); tourShow(0); }

  document.body.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-tour]") : null;
    if (!b) return;
    var a = b.getAttribute("data-tour");
    if (a === "next") tourShow(tour.i + 1);
    else if (a === "back") tourShow(tour.i - 1);
    else tourEnd(true);                 // „Готово“ или „Пропусни“ → не показвай повече
  });

  // първо посещение → пусни въведението (след оформление); тестовете го пропускат
  window.addEventListener("load", function () {
    if (window.__PIF_TEST__) return;
    var seen = "1";
    try { seen = localStorage.getItem("pif_onboarded"); } catch (e) {}
    if (!seen) requestAnimationFrame(function () { setTimeout(startTour, 300); });
  });

  // Тестова кукичка за DOM тестове без браузър (jsdom). Активна САМО когато тестът
  // предварително зададе window.__PIF_TEST__ — в браузъра остава недокосната.
  if (typeof window !== "undefined" && window.__PIF_TEST__) {
    window.__PIF_TEST__ = {
      buildYaml: buildYaml,
      consolidateExtract: consolidateExtract,
      appendIngredient: appendIngredient,
      ingredientCard: ingredientCard,
      syncIncomplete: syncIncomplete,
      syncEmptyState: syncEmptyState,
      inciCase: inciCase
    };
  }
})();
