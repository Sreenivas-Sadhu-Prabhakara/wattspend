/* ============================================================
   wattspend — client-side appliance electricity cost engine.
   No network. No dependencies. State in localStorage.
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

  var STORE_KEY = "wattspend:v1";
  var DAYS_PER_MONTH = 30.44;

  /* ============================================================
     CURRENCY PRESETS — indicative residential rates per kWh.
     The user is told plainly to override from their own bill.
     ============================================================ */
  var CURRENCIES = [
    { code: "PHP", label: "Philippines — ₱ (peso)",    sym: "₱", rate: 11.00 },
    { code: "USD", label: "United States — $ (dollar)",     sym: "$",      rate: 0.17  },
    { code: "INR", label: "India — ₹ (rupee)",          sym: "₹", rate: 8.00  },
    { code: "GBP", label: "United Kingdom — £ (pound)", sym: "£", rate: 0.28  },
    { code: "EUR", label: "Eurozone — € (euro)",        sym: "€", rate: 0.30  },
    { code: "AUD", label: "Australia — $ (dollar)",          sym: "$",      rate: 0.33  }
  ];
  function currencyByCode(code) {
    for (var i = 0; i < CURRENCIES.length; i++) if (CURRENCIES[i].code === code) return CURRENCIES[i];
    return CURRENCIES[1];
  }

  /* ============================================================
     APPLIANCE LIBRARY
     watts   = EFFECTIVE draw (cycling / always-on already accounted for)
     hours   = typical hours per day of "on" time at that effective draw
     days    = days per week (default 7)
     note    = the assumption, shown so nobody is misled
     Defaults are tuned so kWh/day lands in believable territory,
     e.g. fridge ~1.3 kWh/day, router ~0.14 kWh/day.
     ============================================================ */
  var LIBRARY = [
    { id: "ac-split",   name: "Air conditioner (split, 1.5 HP)", w: 1200, h: 8,    d: 7 },
    { id: "ac-window",  name: "Air conditioner (window)",        w: 1000, h: 6,    d: 7 },
    { id: "fridge",     name: "Refrigerator",                    w: 150,  h: 9,    d: 7 },   // ~1.35 kWh/day effective
    { id: "freezer",    name: "Chest freezer",                   w: 100,  h: 10,   d: 7 },   // ~1.0 kWh/day effective
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
    { id: "router",     name: "WiFi router (always on)",         w: 8,    h: 24,   d: 7 },   // ~0.19 kWh/day
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

  /* Sensible starter set on first visit. */
  var STARTER_IDS = ["ac-split", "fridge", "waterheat", "tv", "router", "washer"];

  /* ============================================================
     EFFICIENCY TIPS — honest, general, no invented guarantees.
     Keyed by library id; matched by prefix so custom-added rows
     still get a relevant note.
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
    // generic fallback based on how it's used
    return {
      verb: "Cut the hours.",
      body: "Cost here is driven mostly by how long it runs. Reducing daily hours or switching it off at the wall when idle is the most direct saving."
    };
  }

  /* ============================================================
     STATE
     ============================================================ */
  var state = {
    currency: "USD",
    rate: 0.17,
    appliances: []   // { uid, id, name, w, h, d }
  };
  var storageOk = true;
  var uidSeq = 1;
  function uid() { return "a" + (uidSeq++) + "-" + Math.random().toString(36).slice(2, 6); }

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
      state.appliances = saved.appliances.map(function (a) {
        return {
          uid: uid(),
          id: typeof a.id === "string" ? a.id : "custom",
          name: String(a.name || "Appliance"),
          w: clamp(Number(a.w) || 0, 0, 100000),
          h: clamp(Number(a.h) || 0, 0, 24),
          d: clamp(Number(a.d) || 7, 0, 7)
        };
      });
      return true;
    } catch (e) { return false; }
  }
  function save() {
    if (!storageOk) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        currency: state.currency,
        rate: state.rate,
        appliances: state.appliances.map(function (a) {
          return { id: a.id, name: a.name, w: a.w, h: a.h, d: a.d };
        })
      }));
    } catch (e) { storageOk = false; }
  }

  function seedDefaults() {
    var c = currencyByCode(state.currency);
    state.rate = c.rate;
    state.appliances = STARTER_IDS.map(function (id) {
      var lib = libById(id);
      return { uid: uid(), id: lib.id, name: lib.name, w: lib.w, h: lib.h, d: lib.d };
    });
  }

  /* ============================================================
     THE MATH
     ============================================================ */
  function kwhPerDay(a) { return (a.w * a.h) / 1000; }
  function kwhPerMonth(a) { return kwhPerDay(a) * (a.d / 7) * DAYS_PER_MONTH; }
  function costMonth(a) { return kwhPerMonth(a) * state.rate; }
  function costYear(a) { return costMonth(a) * 12; }

  function compute() {
    var rows = state.appliances.map(function (a) {
      var km = kwhPerMonth(a);
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
  // Zero-decimal currencies (PHP/INR big numbers read better without cents;
  // small-unit currencies keep 2 dp). We pick decimals by magnitude, not locale,
  // so it stays readable for any rate the user types.
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

  /* ============================================================
     RENDER
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

  function renderLibrary() {
    var root = $("#library");
    root.innerHTML = "";
    LIBRARY.forEach(function (lib) {
      var btn = el("button", "lib");
      btn.type = "button";
      var plus = el("span", "lib__plus", "+");
      plus.setAttribute("aria-hidden", "true");
      btn.appendChild(plus);
      var body = el("span", "lib__body");
      body.appendChild(el("span", "lib__name", lib.name));
      var kd = (lib.w * lib.h) / 1000;
      body.appendChild(el("span", "lib__spec", lib.w + " W · " + num(kd, kd < 1 ? 2 : 1) + " kWh/day"));
      btn.appendChild(body);
      btn.setAttribute("aria-label", "Add " + lib.name);
      btn.addEventListener("click", function () { addAppliance(lib.id); });
      root.appendChild(btn);
    });
  }

  function renderAll() {
    var data = compute();
    renderTotals(data);
    renderWins(data);
    renderList(data);
    renderRate();
    updateLibraryDisabled();
  }

  function renderTotals(data) {
    $("#totalMonth").textContent = money(data.totalMonth);
    $("#totalYear").textContent = money(data.totalYear);
    $("#totalKwh").textContent = num(data.totalKwh, 0);
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
      card.appendChild(el("h3", "win__name", r.a.name));
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
      li.dataset.uid = a.uid;

      /* --- main row --- */
      var main = el("div", "appliance__main");
      main.appendChild(el("span", "appliance__rank", String(idx + 1)));

      var id = el("div", "appliance__id");
      var name = el("div", "appliance__name");
      name.appendChild(document.createTextNode(a.name));
      if (isTop) {
        var flag = el("span", "appliance__flag", "biggest drainer");
        name.appendChild(flag);
      }
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

      /* --- editable knobs --- */
      var edit = el("div", "appliance__edit");
      edit.appendChild(knob(a, "w", "Watts", "W", 5, 100000, 5, "knob--w"));
      edit.appendChild(knob(a, "h", "Hours / day", "h", 0, 24, 0.25, "knob--h"));
      edit.appendChild(knob(a, "d", "Days / week", "d/wk", 0, 7, 1, "knob--d"));

      var rm = el("button", "appliance__remove", "Remove");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove " + a.name);
      rm.addEventListener("click", function () { removeAppliance(a.uid); });
      edit.appendChild(rm);

      li.appendChild(edit);
      root.appendChild(li);
    });
  }

  function knob(a, field, label, unit, min, max, step, cls) {
    var wrap = el("div", "knob");
    var lid = "k-" + a.uid + "-" + field;
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
      a[field] = clamp(v, min, max);
      save();
      renderAll();
      // keep focus on the field being edited after re-render
      var again = document.getElementById(lid);
      if (again) { again.focus(); placeCaretEnd(again); }
    });
    input.addEventListener("blur", function () {
      var v = parseFloat(input.value);
      a[field] = isNaN(v) ? (field === "d" ? 7 : 0) : clamp(v, min, max);
      input.value = a[field];
      save();
      renderAll();
    });
    box.appendChild(input);
    box.appendChild(el("span", "knob__unit", unit));
    wrap.appendChild(box);
    return wrap;
  }
  function placeCaretEnd(input) {
    try { var v = input.value; input.value = ""; input.value = v; } catch (e) {}
  }

  function updateLibraryDisabled() {
    // no hard disabling — duplicates are allowed (two ACs, many bulbs).
    // Kept as a hook; currently all library buttons stay enabled.
  }

  /* ============================================================
     ACTIONS
     ============================================================ */
  function addAppliance(libId) {
    var lib = libById(libId);
    if (!lib) return;
    state.appliances.push({ uid: uid(), id: lib.id, name: lib.name, w: lib.w, h: lib.h, d: lib.d });
    save();
    renderAll();
    // reveal the freshly added row area
    var app = $("#app");
    if (app && app.scrollIntoView) { /* stay put; totals update in place */ }
  }
  function removeAppliance(u) {
    state.appliances = state.appliances.filter(function (a) { return a.uid !== u; });
    save();
    renderAll();
  }
  function resetAll() {
    seedDefaults();
    save();
    renderCurrencyOptions();
    renderRate();
    renderAll();
  }

  /* ============================================================
     WIRE UP
     ============================================================ */
  function init() {
    var had = load();
    if (!had) { state.currency = "USD"; seedDefaults(); save(); }

    renderCurrencyOptions();
    renderLibrary();
    renderRate();
    renderAll();
    renderWave();

    $("#currency").addEventListener("change", function () {
      state.currency = $("#currency").value;
      // adopt the preset rate for the newly chosen region
      state.rate = currencyByCode(state.currency).rate;
      save();
      renderRate();
      renderAll();
    });

    $("#rate").addEventListener("input", function () {
      var v = parseFloat($("#rate").value);
      if (isNaN(v) || v < 0) return;
      state.rate = v;
      save();
      renderAll();
    });
    $("#rate").addEventListener("blur", function () {
      var v = parseFloat($("#rate").value);
      state.rate = isNaN(v) || v < 0 ? currencyByCode(state.currency).rate : v;
      $("#rate").value = state.rate;
      save();
      renderAll();
    });

    $("#printBtn").addEventListener("click", function () { window.print(); });
    $("#resetBtn").addEventListener("click", function () {
      if (window.confirm("Reset to the starter appliances and preset rate? Your edits will be cleared.")) {
        resetAll();
      }
    });
  }

  /* ============================================================
     WAVEFORM SIGNATURE — an AC sine wave, drawn as a path.
     Two offset traces drift slowly (frozen for reduced motion).
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
