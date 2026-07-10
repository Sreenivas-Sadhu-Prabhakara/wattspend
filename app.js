/* ============================================================
   wattspend — client-side appliance electricity cost engine.
   Guided flow: (1) your rate -> (2) pick appliances -> (3) cost + share.
   No network. No dependencies. State in localStorage + a shareable hash.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function prefersReduced() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  var STORE_KEY = "wattspend:v1";
  var DAYS_PER_MONTH = 30.44;

  /* ============================================================
     CURRENCY PRESETS — indicative residential rates per kWh.
     The user is told plainly to override from their own bill.
     ============================================================ */
  var CURRENCIES = [
    { code: "PHP", label: "Philippines — ₱ (peso)",      sym: "₱", rate: 11.00 },
    { code: "USD", label: "United States — $ (dollar)",  sym: "$", rate: 0.17  },
    { code: "INR", label: "India — ₹ (rupee)",           sym: "₹", rate: 8.00  },
    { code: "GBP", label: "United Kingdom — £ (pound)",  sym: "£", rate: 0.28  },
    { code: "EUR", label: "Eurozone — € (euro)",         sym: "€", rate: 0.30  },
    { code: "AUD", label: "Australia — $ (dollar)",      sym: "$", rate: 0.33  }
  ];
  function currencyByCode(code) {
    for (var i = 0; i < CURRENCIES.length; i++) if (CURRENCIES[i].code === code) return CURRENCIES[i];
    return CURRENCIES[1];
  }

  /* ============================================================
     APPLIANCE LIBRARY
     watts = EFFECTIVE draw (cycling / always-on already accounted for)
     hours = typical hours per day of "on" time at that effective draw
     days  = days per week (default 7)
     Defaults are tuned so kWh/day lands in believable territory,
     e.g. fridge ~1.35 kWh/day, router ~0.19 kWh/day.
     ============================================================ */
  var LIBRARY = [
    { id: "ac-split",   name: "Air conditioner (split, 1.5 HP)", w: 1200, h: 8,    d: 7 },
    { id: "ac-window",  name: "Air conditioner (window)",        w: 1000, h: 6,    d: 7 },
    { id: "fridge",     name: "Refrigerator",                    w: 150,  h: 9,    d: 7 },
    { id: "freezer",    name: "Chest freezer",                   w: 100,  h: 10,   d: 7 },
    { id: "waterheat",  name: "Electric water heater (tank)",    w: 3000, h: 1.5,  d: 7 },
    { id: "kettle",     name: "Electric kettle",                 w: 2000, h: 0.25, d: 7 },
    { id: "ricecooker", name: "Rice cooker",                     w: 400,  h: 1,    d: 7 },
    { id: "microwave",  name: "Microwave oven",                  w: 1000, h: 0.3,  d: 7 },
    { id: "washer",     name: "Washing machine",                 w: 500,  h: 1,    d: 4 },
    { id: "dryer",      name: "Clothes dryer",                   w: 2500, h: 1,    d: 4 },
    { id: "dishwasher", name: "Dishwasher",                      w: 1200, h: 1,    d: 7 },
    { id: "fan",        name: "Ceiling fan",                     w: 60,   h: 10,   d: 7 },
    { id: "tv",         name: "Television (LED, 50\")",          w: 90,   h: 5,    d: 7 },
    { id: "desktop",    name: "Desktop / gaming PC",             w: 300,  h: 4,    d: 7 },
    { id: "laptop",     name: "Laptop",                          w: 50,   h: 6,    d: 7 },
    { id: "router",     name: "WiFi router (always on)",         w: 8,    h: 24,   d: 7 },
    { id: "bulb-inc",   name: "Incandescent bulb",               w: 60,   h: 5,    d: 7 },
    { id: "bulb-led",   name: "LED bulb",                        w: 9,    h: 5,    d: 7 },
    { id: "heater",     name: "Space heater",                    w: 1500, h: 4,    d: 7 },
    { id: "poolpump",   name: "Pool pump",                       w: 1100, h: 6,    d: 7 },
    { id: "ev",         name: "EV charging (home, Level 2)",     w: 7000, h: 1.5,  d: 5 }
  ];
  function libById(id) {
    for (var i = 0; i < LIBRARY.length; i++) if (LIBRARY[i].id === id) return LIBRARY[i];
    return null;
  }

  /* ============================================================
     EFFICIENCY TIPS — honest, general, no invented guarantees.
     ============================================================ */
  var TIPS = {
    "ac-split":  { verb: "Set it warmer.", body: "Every 1°C higher on the thermostat trims roughly 3–5% off cooling energy; a clean filter and a fan to spread the cool air let you sit at a higher setting." },
    "ac-window": { verb: "Set it warmer.", body: "Every 1°C higher on the thermostat trims roughly 3–5% off cooling energy; seal gaps around the unit so it isn't fighting warm outside air." },
    "waterheat": { verb: "Lower and insulate.", body: "Dropping the tank thermostat to about 50–60°C and insulating the tank and first metre of pipe cuts standby heat loss; a timer avoids reheating water nobody uses overnight." },
    "dryer":     { verb: "Air-dry when you can.", body: "The dryer is nearly all heat, so it's costly per load; line-drying or spinning clothes at a higher speed first, and cleaning the lint filter, both help." },
    "heater":    { verb: "Heat the person, not the room.", body: "Resistive heaters convert power straight to heat, so cost scales with runtime; a lower setting, a closed door, and warmer layers cut the hours it runs." },
    "fridge":    { verb: "Give it room to breathe.", body: "Keep coils dust-free, leave a gap behind it, check the door seal, and don't set it colder than about 3–4°C — an old second fridge is often the quiet drain to retire." },
    "freezer":   { verb: "Keep it full and sealed.", body: "A full freezer holds cold better than an empty one; check the seal and defrost if frost builds up, since ice makes it work harder." },
    "bulb-inc":  { verb: "Swap to LED.", body: "Replacing incandescent bulbs with LED cuts their energy use by around 85% for the same light — one of the cheapest, fastest wins on this list." },
    "poolpump":  { verb: "Run it less.", body: "Most pools stay clean on far fewer pump hours than people assume; a shorter daily cycle, or a variable-speed pump run slow-and-long, uses much less." },
    "desktop":   { verb: "Sleep it.", body: "A gaming PC left idle still draws real power; enable sleep, and switch off at the wall to kill standby draw when you're done for the day." },
    "ev":        { verb: "Charge off-peak.", body: "The energy is fixed by how far you drive, but many tariffs are cheaper overnight — scheduling charging for off-peak hours can lower the cost without changing anything else." },
    "dishwasher":{ verb: "Full loads, eco mode.", body: "Run it only when full and use the eco cycle; skipping the heated-dry option and letting dishes air-dry avoids a chunk of the energy." }
  };
  function tipFor(item) {
    if (TIPS[item.id]) return TIPS[item.id];
    return {
      verb: "Cut the hours.",
      body: "Cost here is driven mostly by how long it runs. Reducing daily hours or switching it off at the wall when idle is the most direct saving."
    };
  }

  /* ============================================================
     STATE — appliances are keyed by library id (with a quantity).
     ============================================================ */
  var state = {
    currency: "USD",
    rate: 0.17,
    step: 1,
    appliances: []   // { id, name, w, h, d, q }
  };
  var storageOk = true;

  function findApp(id) {
    for (var i = 0; i < state.appliances.length; i++) if (state.appliances[i].id === id) return state.appliances[i];
    return null;
  }
  function isSelected(id) { return !!findApp(id); }
  function addApp(id) {
    if (isSelected(id)) return;
    var lib = libById(id);
    if (!lib) return;
    state.appliances.push({ id: lib.id, name: lib.name, w: lib.w, h: lib.h, d: lib.d, q: 1 });
  }
  function removeApp(id) {
    state.appliances = state.appliances.filter(function (a) { return a.id !== id; });
  }

  /* ---------- storage ---------- */
  function load() {
    try { localStorage.setItem(STORE_KEY + ":t", "1"); localStorage.removeItem(STORE_KEY + ":t"); }
    catch (e) { storageOk = false; }
    if (!storageOk) return false;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.appliances)) return false;
      state.currency = typeof saved.currency === "string" ? saved.currency : "USD";
      state.rate = isFinite(saved.rate) && saved.rate >= 0 ? saved.rate : currencyByCode(state.currency).rate;
      // collapse to one row per id (summing any legacy duplicates into a quantity)
      var map = {}, order = [];
      saved.appliances.forEach(function (a) {
        var id = typeof a.id === "string" ? a.id : "custom";
        var lib = libById(id);
        var q = clamp(Math.round(Number(a.q) || 1), 1, 999);
        if (!map[id]) {
          map[id] = {
            id: id,
            name: lib ? lib.name : String(a.name || "Appliance"),
            w: clamp(Number(a.w) || 0, 0, 100000),
            h: clamp(Number(a.h) || 0, 0, 24),
            d: clamp(a.d != null ? Number(a.d) : 7, 0, 7),
            q: q
          };
          order.push(id);
        } else {
          map[id].q = clamp(map[id].q + q, 1, 999);
        }
      });
      state.appliances = order.map(function (id) { return map[id]; });
      state.step = (saved.step === 1 || saved.step === 2 || saved.step === 3) ? saved.step : (state.appliances.length ? 3 : 1);
      return true;
    } catch (e) { return false; }
  }
  function save() {
    if (!storageOk) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        currency: state.currency,
        rate: state.rate,
        step: state.step,
        appliances: state.appliances.map(function (a) {
          return { id: a.id, name: a.name, w: a.w, h: a.h, d: a.d, q: a.q };
        })
      }));
    } catch (e) { storageOk = false; }
  }

  /* ============================================================
     SHARE STATE <-> compact url hash (#s=...)
     Encodes currency, rate, and [id, w, h, d, q] rows. No network:
     the whole result travels inside the link.
     ============================================================ */
  function encodeState() {
    var payload = {
      c: state.currency,
      r: state.rate,
      a: state.appliances.map(function (a) { return [a.id, a.w, a.h, a.d, a.q]; })
    };
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeState(s) {
    try {
      var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var p = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!p || !Array.isArray(p.a)) return null;
      var cur = typeof p.c === "string" ? p.c : "USD";
      var rate = isFinite(p.r) && p.r >= 0 ? p.r : currencyByCode(cur).rate;
      var apps = [], seen = {};
      p.a.forEach(function (row) {
        if (!Array.isArray(row)) return;
        var id = typeof row[0] === "string" ? row[0] : "custom";
        if (seen[id]) return;
        seen[id] = true;
        var lib = libById(id);
        apps.push({
          id: id,
          name: lib ? lib.name : "Appliance",
          w: clamp(Number(row[1]) || 0, 0, 100000),
          h: clamp(Number(row[2]) || 0, 0, 24),
          d: clamp(row[3] != null ? Number(row[3]) : 7, 0, 7),
          q: clamp(Math.round(Number(row[4]) || 1), 1, 999)
        });
      });
      return { currency: cur, rate: rate, appliances: apps };
    } catch (e) { return null; }
  }
  function updateHash() {
    try { history.replaceState(null, "", location.pathname + location.search + "#s=" + encodeState()); }
    catch (e) {}
  }
  function clearHash() {
    try { if (location.hash) history.replaceState(null, "", location.pathname + location.search); }
    catch (e) {}
  }

  /* ============================================================
     THE MATH  (per-unit; quantity applied in compute)
     ============================================================ */
  function kwhPerDay(a) { return (a.w * a.h) / 1000; }
  function kwhPerMonth(a) { return kwhPerDay(a) * (a.d / 7) * DAYS_PER_MONTH; }

  function compute() {
    var rows = state.appliances.map(function (a) {
      var km = kwhPerMonth(a) * (a.q || 1);
      return { a: a, kwhMonth: km, month: km * state.rate, year: km * state.rate * 12 };
    });
    var totalMonth = rows.reduce(function (s, r) { return s + r.month; }, 0);
    var totalKwh = rows.reduce(function (s, r) { return s + r.kwhMonth; }, 0);
    rows.forEach(function (r) { r.share = totalMonth > 0 ? (r.month / totalMonth) : 0; });
    rows.sort(function (x, y) { return y.month - x.month; });
    var maxMonth = rows.length ? rows[0].month : 0;
    rows.forEach(function (r) { r.barPct = maxMonth > 0 ? (r.month / maxMonth) * 100 : 0; });
    return { rows: rows, totalMonth: totalMonth, totalYear: totalMonth * 12, totalKwh: totalKwh };
  }

  /* ============================================================
     FORMATTING
     ============================================================ */
  function sym() { return currencyByCode(state.currency).sym; }
  function money(v) {
    var s = sym();
    if (!isFinite(v)) v = 0;
    var dp = v >= 100 ? 0 : (v >= 10 ? 1 : 2);
    return s + v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function num(v, dp) {
    if (dp == null) dp = 2;
    return (isFinite(v) ? v : 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function pct(v) { return Math.round(v * 100) + "%"; }
  function rateStr() {
    var v = state.rate;
    var rounded = Math.round(v * 100) / 100;
    return sym() + (isFinite(rounded) ? rounded : 0);
  }

  /* ============================================================
     RENDER — rate / picker / result
     ============================================================ */
  function renderCurrencyOptions() {
    var sel = $("#currency");
    sel.innerHTML = "";
    CURRENCIES.forEach(function (c) {
      var o = el("option", null, c.label);
      o.value = c.code;
      sel.appendChild(o);
    });
    sel.value = state.currency;
  }
  function renderRate() {
    $("#rateSym").textContent = sym();
    var input = $("#rate");
    if (document.activeElement !== input) input.value = state.rate;
  }

  /* ---------- Step 2: the picker ---------- */
  function renderPicker() {
    var root = $("#picker");
    root.innerHTML = "";
    LIBRARY.forEach(function (lib) {
      var on = isSelected(lib.id);
      var card = el("div", "pick" + (on ? " is-on" : ""));
      card.dataset.id = lib.id;

      var main = el("label", "pick__main");
      var cb = el("input");
      cb.type = "checkbox";
      cb.className = "pick__check";
      cb.checked = on;
      main.appendChild(cb);
      var body = el("span", "pick__body");
      body.appendChild(el("span", "pick__name", lib.name));
      var kd = (lib.w * lib.h) / 1000;
      body.appendChild(el("span", "pick__spec", lib.w + " W · " + num(kd, kd < 1 ? 2 : 1) + " kWh/day"));
      main.appendChild(body);
      card.appendChild(main);

      var qwrap = el("div", "pick__qty");
      if (!on) qwrap.hidden = true;
      qwrap.appendChild(el("span", "pick__qlab", "How many"));
      var qty = el("div", "qty");
      var dec = el("button", "qty__btn", "−"); dec.type = "button"; dec.setAttribute("aria-label", "Fewer " + lib.name);
      var val = el("input"); val.type = "number"; val.className = "qty__val";
      val.min = 1; val.max = 999; val.step = 1;
      val.value = on ? (findApp(lib.id).q || 1) : 1;
      val.inputMode = "numeric";
      val.setAttribute("aria-label", "Number of " + lib.name);
      var inc = el("button", "qty__btn", "+"); inc.type = "button"; inc.setAttribute("aria-label", "More " + lib.name);
      qty.appendChild(dec); qty.appendChild(val); qty.appendChild(inc);
      qwrap.appendChild(qty);
      card.appendChild(qwrap);

      function selectOn() {
        if (!isSelected(lib.id)) addApp(lib.id);
        cb.checked = true; card.classList.add("is-on"); qwrap.hidden = false;
      }
      cb.addEventListener("change", function () {
        if (cb.checked) { addApp(lib.id); card.classList.add("is-on"); qwrap.hidden = false; val.value = findApp(lib.id).q || 1; }
        else { removeApp(lib.id); card.classList.remove("is-on"); qwrap.hidden = true; }
        save(); updatePickCount(); updateStepper();
      });
      function bump(delta) {
        selectOn();
        var a = findApp(lib.id); a.q = clamp((a.q || 1) + delta, 1, 999);
        val.value = a.q; save(); updatePickCount(); updateStepper();
      }
      dec.addEventListener("click", function () { bump(-1); });
      inc.addEventListener("click", function () { bump(1); });
      val.addEventListener("input", function () {
        var v = parseInt(val.value, 10);
        if (isNaN(v)) return;
        selectOn();
        findApp(lib.id).q = clamp(v, 1, 999);
        save(); updatePickCount(); updateStepper();
      });
      val.addEventListener("blur", function () {
        var v = parseInt(val.value, 10);
        if (isSelected(lib.id)) { var a = findApp(lib.id); a.q = isNaN(v) ? 1 : clamp(v, 1, 999); val.value = a.q; save(); }
      });

      root.appendChild(card);
    });
    updatePickCount();
  }
  function updatePickCount() {
    var n = state.appliances.length;
    var q = state.appliances.reduce(function (s, a) { return s + (a.q || 1); }, 0);
    var label = n ? (n + " type" + (n > 1 ? "s" : "") + " · " + q + " item" + (q > 1 ? "s" : "")) : "Nothing picked yet";
    var pc = $("#pickCount"); if (pc) pc.textContent = label;
    var btn = $("#toStep3"); if (btn) btn.disabled = n === 0;
  }

  /* ---------- Step 3: the result ---------- */
  function renderResult() {
    var data = compute();
    $("#totalMonth").textContent = money(data.totalMonth);
    $("#totalYear").textContent = money(data.totalYear);
    $("#totalKwh").textContent = num(data.totalKwh, 0);
    $("#totalsRate").textContent = "at " + rateStr() + " / kWh";
    renderWins(data);
    renderList(data);
  }

  function renderWins(data) {
    var sec = $("#wins");
    var grid = $("#winsGrid");
    grid.innerHTML = "";
    var top = data.rows.filter(function (r) { return r.month > 0; }).slice(0, 3);
    if (!top.length) { sec.hidden = true; return; }
    sec.hidden = false;
    top.forEach(function (r, i) {
      var card = el("div", "win" + (i === 0 ? " win--top" : ""));
      card.appendChild(el("span", "win__rank", "#" + (i + 1) + " biggest cost"));
      card.appendChild(el("h3", "win__name", r.a.name + ((r.a.q || 1) > 1 ? " ×" + r.a.q : "")));
      var share = el("p", "win__share");
      share.appendChild(el("b", null, pct(r.share)));
      share.appendChild(document.createTextNode(" of your bill · " + money(r.month) + "/mo"));
      card.appendChild(share);
      var tip = tipFor(r.a);
      var tp = el("p", "win__tip");
      tp.appendChild(el("strong", null, tip.verb + " "));
      tp.appendChild(document.createTextNode(tip.body));
      card.appendChild(tp);
      grid.appendChild(card);
    });
  }

  function renderList(data) {
    var root = $("#applist");
    root.innerHTML = "";
    $("#emptyState").hidden = data.rows.length > 0;

    data.rows.forEach(function (r, idx) {
      var a = r.a;
      var isTop = idx === 0 && r.month > 0;
      var li = el("li", "appliance" + (isTop ? " is-top" : ""));
      li.dataset.id = a.id;

      var main = el("div", "appliance__main");
      main.appendChild(el("span", "appliance__rank", String(idx + 1)));

      var id = el("div", "appliance__id");
      var name = el("div", "appliance__name");
      name.appendChild(document.createTextNode(a.name));
      if ((a.q || 1) > 1) name.appendChild(el("span", "appliance__mult", "×" + a.q));
      if (isTop) name.appendChild(el("span", "appliance__flag", "biggest drainer"));
      id.appendChild(name);
      var bar = el("div", "appliance__bar");
      var barFill = el("span");
      barFill.style.width = r.barPct.toFixed(1) + "%";
      bar.appendChild(barFill);
      id.appendChild(bar);
      main.appendChild(id);

      var cost = el("div", "appliance__cost");
      cost.appendChild(el("div", "appliance__month", money(r.month)));
      cost.appendChild(el("div", "appliance__sub", money(r.year) + "/yr"));
      cost.appendChild(el("div", "appliance__share", pct(r.share) + " of bill · " + num(r.kwhMonth, 0) + " kWh/mo"));
      main.appendChild(cost);
      li.appendChild(main);

      var edit = el("div", "appliance__edit");
      edit.appendChild(knob(a, "q", "How many", "×", 1, 999, 1, "knob--q", 1));
      edit.appendChild(knob(a, "w", "Watts", "W", 5, 100000, 5, "knob--w", 0));
      edit.appendChild(knob(a, "h", "Hours / day", "h", 0, 24, 0.25, "knob--h", 0));
      edit.appendChild(knob(a, "d", "Days / week", "d/wk", 0, 7, 1, "knob--d", 7));

      var rm = el("button", "appliance__remove", "Remove");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove " + a.name);
      rm.addEventListener("click", function () {
        removeApp(a.id); save();
        if (state.appliances.length === 0) { clearHash(); goStep(2); return; }
        renderResult(); updateHash(); updateStepper();
      });
      edit.appendChild(rm);

      li.appendChild(edit);
      root.appendChild(li);
    });
  }

  function knob(a, field, label, unit, min, max, step, cls, dflt) {
    var wrap = el("div", "knob");
    var lid = "k-" + a.id + "-" + field;
    var l = el("label", null, label);
    l.setAttribute("for", lid);
    wrap.appendChild(l);
    var box = el("div", "knob__input");
    var input = el("input");
    input.type = "number";
    input.id = lid;
    input.className = cls;
    input.min = min; input.max = max; input.step = step;
    input.value = a[field];
    input.inputMode = "decimal";
    input.addEventListener("input", function () {
      var v = parseFloat(input.value);
      if (isNaN(v)) return;               // let them clear/type freely
      a[field] = (field === "q") ? clamp(Math.round(v), min, max) : clamp(v, min, max);
      save();
      renderResult(); updateHash(); updateStepper();
      var again = document.getElementById(lid);
      if (again) { again.focus(); placeCaretEnd(again); }
    });
    input.addEventListener("blur", function () {
      var v = parseFloat(input.value);
      a[field] = isNaN(v) ? dflt : ((field === "q") ? clamp(Math.round(v), min, max) : clamp(v, min, max));
      input.value = a[field];
      save();
      renderResult(); updateHash();
    });
    box.appendChild(input);
    box.appendChild(el("span", "knob__unit", unit));
    wrap.appendChild(box);
    return wrap;
  }
  function placeCaretEnd(input) {
    try { var v = input.value; input.value = ""; input.value = v; } catch (e) {}
  }

  /* ============================================================
     STEP NAVIGATION
     ============================================================ */
  function goStep(n) {
    state.step = n;
    [1, 2, 3].forEach(function (i) {
      var s = document.getElementById("step" + i);
      if (s) s.hidden = (i !== n);
    });
    updateStepper();
    if (n === 2) renderPicker();
    if (n === 3) { renderResult(); updateHash(); } else { clearHash(); }
    save();
    window.scrollTo({ top: 0, behavior: prefersReduced() ? "auto" : "smooth" });
    var sec = document.getElementById("step" + n);
    if (sec && sec.focus) { try { sec.focus({ preventScroll: true }); } catch (e) { sec.focus(); } }
  }
  function updateStepper() {
    var reach3 = state.appliances.length > 0;
    $$(".stepper__item").forEach(function (li) {
      var btn = li.querySelector(".stepper__btn");
      if (!btn) return;
      var n = parseInt(btn.getAttribute("data-goto"), 10);
      li.classList.toggle("is-active", n === state.step);
      li.classList.toggle("is-done", n < state.step);
      var disabled = (n === 3 && !reach3);
      li.setAttribute("aria-disabled", disabled ? "true" : "false");
      btn.disabled = disabled;
    });
  }

  /* ============================================================
     SHARE
     ============================================================ */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("is-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-show"); }, 3400);
  }
  function fallbackCopy(t) {
    try {
      var ta = document.createElement("textarea");
      ta.value = t; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallbackCopy(t); });
    }
    return Promise.resolve(fallbackCopy(t));
  }
  function shareResult() {
    var data = compute();
    if (!data.rows.length) { goStep(2); return; }
    var url = location.origin + location.pathname + "#s=" + encodeState();
    var top = data.rows.filter(function (r) { return r.month > 0; }).slice(0, 3).map(function (r) {
      return r.a.name + ((r.a.q || 1) > 1 ? " ×" + r.a.q : "") + " " + money(r.month) + "/mo (" + pct(r.share) + ")";
    });
    var text = "My appliances cost about " + money(data.totalMonth) + "/mo (" + money(data.totalYear) +
      "/yr) to run at " + rateStr() + "/kWh.";
    if (top.length) text += "\nBiggest: " + top.join(", ") + ".";
    text += "\nWorked out with wattspend.";

    if (navigator.share) {
      navigator.share({ title: "wattspend — my running costs", text: text, url: url }).catch(function () {});
      return;
    }
    copyText(text + "\n" + url).then(function (ok) {
      toast(ok ? "Result + link copied — paste it anywhere." : "Couldn't copy automatically — your link is in the address bar.");
    });
  }

  /* ============================================================
     WIRE UP
     ============================================================ */
  function bindEvents() {
    $("#currency").addEventListener("change", function () {
      state.currency = $("#currency").value;
      state.rate = currencyByCode(state.currency).rate;   // adopt preset for the region
      save(); renderRate();
      if (state.step === 3) { renderResult(); updateHash(); }
    });
    $("#rate").addEventListener("input", function () {
      var v = parseFloat($("#rate").value);
      if (isNaN(v) || v < 0) return;
      state.rate = v; save();
      if (state.step === 3) { renderResult(); updateHash(); }
    });
    $("#rate").addEventListener("blur", function () {
      var v = parseFloat($("#rate").value);
      state.rate = (isNaN(v) || v < 0) ? currencyByCode(state.currency).rate : v;
      $("#rate").value = state.rate; save();
      if (state.step === 3) { renderResult(); updateHash(); }
    });

    $("#toStep2").addEventListener("click", function () { goStep(2); });
    $("#backTo1").addEventListener("click", function () { goStep(1); });
    $("#toStep3").addEventListener("click", function () { if (state.appliances.length) goStep(3); });
    $("#editPick").addEventListener("click", function () { goStep(2); });
    $("#emptyPick").addEventListener("click", function () { goStep(2); });
    $("#printBtn").addEventListener("click", function () { window.print(); });
    $("#shareBtn").addEventListener("click", shareResult);
    $("#resetBtn").addEventListener("click", function () {
      if (window.confirm("Start over? This clears the appliances you picked.")) {
        state.appliances = [];
        state.rate = currencyByCode(state.currency).rate;
        save(); renderCurrencyOptions(); renderRate(); clearHash(); goStep(1);
      }
    });

    $$(".stepper__btn").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.disabled) return;
        var n = parseInt(b.getAttribute("data-goto"), 10);
        if (n === 3 && state.appliances.length === 0) { goStep(2); return; }
        goStep(n);
      });
    });
  }

  function init() {
    var had = load();

    // A shared link wins: decode it and jump straight to the result.
    var shared = null;
    var m = (location.hash || "").match(/[#&]s=([^&]+)/);
    if (m) shared = decodeState(m[1]);
    if (shared) {
      state.currency = shared.currency;
      state.rate = shared.rate;
      state.appliances = shared.appliances;
      save();
    } else if (!had) {
      state.currency = "USD";
      state.rate = currencyByCode("USD").rate;
      state.appliances = [];
      state.step = 1;
    }

    renderCurrencyOptions();
    renderRate();
    renderWave();
    bindEvents();

    var start = shared ? 3 : (state.appliances.length > 0 ? (state.step === 2 ? 2 : 3) : 1);
    goStep(start);
  }

  /* ============================================================
     WAVEFORM SIGNATURE — an AC sine wave, drawn as a path.
     ============================================================ */
  function renderWave() {
    var w1 = $(".wave__line--1");
    var w2 = $(".wave__line--2");
    if (!w1 || !w2) return;
    var W = 1600, baseY = 160;
    function trace(amp, wavelen, phase, yShift) {
      var d = "M -80 " + (baseY + yShift).toFixed(1);
      for (var x = -80; x <= W; x += 16) {
        var y = baseY + yShift
          + Math.sin((x / wavelen) + phase) * amp
          + Math.sin((x / (wavelen * 0.5)) + phase * 1.6) * (amp * 0.22);
        d += " L " + x + " " + y.toFixed(1);
      }
      return d;
    }
    w1.setAttribute("d", trace(58, 240, 0, -18));
    w2.setAttribute("d", trace(42, 300, 1.1, 26));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
