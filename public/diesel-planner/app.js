(function () {
  const { fmt, esc, gauge, bandBars, monthly, meter } = Charts;
  const M = Model;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let D = window.__PLANNER_DATA__;
  const KEY = "wgp.state.v1";
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  };
  const saved = store.get();
  const state = {
    view: "overview",
    plan: { ...M.DEFAULTS, ...(saved.plan || {}) },
    report: saved.report || {},
    orders: { q: "", status: "all", sort: "listed_date", dir: -1, page: 0 },
    chartMode: "gal",
  };
  const persist = () => store.set({ plan: state.plan, report: state.report });

  const VIEWS = {
    overview: { title: "Overview", icon: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" },
    planner: { title: "Planner", icon: "M4 19V9m6 10V5m6 14v-7m6 7H2" },
    orders: { title: "Orders", icon: "M4 6h16M4 12h16M4 18h10" },
    report: { title: "Report creator", icon: "M7 3h8l4 4v14H7zM14 3v5h5M10 13h6M10 17h6" },
    sources: { title: "Sources & limits", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v5m0 3v.01" },
  };
  const ico = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

  /* ---------- shell ---------- */
  function shell() {
    if (!$("#chartCss")) { const st = document.createElement("style"); st.id = "chartCss"; st.textContent = Charts.CHART_CSS; document.head.append(st); }
    $("#nav").innerHTML = Object.entries(VIEWS).map(([k, v]) => `<a href="#${k}" data-v="${k}">${ico(v.icon)}<span>${v.title}</span></a>`).join("");
    const c = D.contract;
    $("#chips").innerHTML = [`Vendor acct ${esc(c.vendor_account)}`, "Diesel · tank wagon / transport", `${esc(c.agreement)} · ends ${esc(fmt.date(c.term_end))}`, `Snapshot ${esc(fmt.date(D.as_of))}`].map((t) => `<span class="chip">${t}</span>`).join("");
  }

  function route() {
    const v = (location.hash || "#overview").slice(1);
    state.view = VIEWS[v] ? v : "overview";
    $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.v === state.view));
    $("#tabs").innerHTML = "";
    ({ overview, planner, orders, report: reportView, sources }[state.view])();
    $("#main").scrollTop = 0; window.scrollTo(0, 0);
  }

  /* ---------- overview ---------- */
  function overview() {
    const S = D.summary, P = M.plan(D, state.plan), months = P.rec;
    const score = (S.matched_orders / S.orders_count) * 10;
    const pctMatched = (S.matched_orders / S.orders_count) * 100;
    const bands = M.matchBands(D.orders);
    const follow = D.orders.filter((o) => o.invoice_total == null).sort((a, b) => b.listed_date.localeCompare(a.listed_date));
    $("#view").innerHTML = `
    <p class="note">${ico("M12 8v5m0 3v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z")}<span>Showing ${fmt.n(S.orders_count)} diesel-coded purchase orders listed ${esc(fmt.date(D.orders.reduce((a, o) => (o.listed_date < a ? o.listed_date : a), "9999")))} to ${esc(fmt.date(D.orders.reduce((a, o) => (o.listed_date > a ? o.listed_date : a), "0")))}. Year in progress: these are snapshot figures, not full-year totals.</span></p>
    <div class="grid g-top">
      <article class="card"><h3>Order-to-invoice score</h3><p class="sub">Matched orders ÷ orders, scaled 0–10</p><div class="center">${gauge(score)}</div><p class="foot">${fmt.n(S.matched_orders)} of ${fmt.n(S.orders_count)} orders match a posted invoice</p></article>
      <article class="card"><div class="row"><h3>Orders by invoice check</h3><div class="seg" id="segB"><button class="on" data-m="match">Match</button><button data-m="size">Order size</button></div></div>
        <div class="split"><div class="big"><b>${pctMatched.toFixed(0)}<small>%</small></b><span id="bigLbl">of orders have an invoice in the loaded file</span></div><div id="bandChart">${bandBars(bands)}</div></div></article>
    </div>
    <div class="grid g-kpi">
      ${kpi("Ordered gallons", fmt.n(S.ordered_gallons), "inferred unit, diesel lines only", fmt.pct(P.ytdShare) + " of 600k/yr bid estimate at this pace", P.ytdShare)}
      ${kpi("Diesel line amount", fmt.usd(S.po_fuel_amount), `implied ${fmt.usd2(P.ytdPrice)}/gal YTD`, `last 3 months ${fmt.usd2(P.impliedPrice)}/gal`, Math.min(100, (P.impliedPrice / (P.ytdPrice * 1.5)) * 100))}
      ${kpi("Full PO total", fmt.usd(S.po_total), "includes tax, biodiesel, additives", `${P.upliftDerived.toFixed(0)}% above diesel line amount`, Math.min(100, P.upliftDerived))}
      ${kpi("Posted invoices", fmt.usd(S.invoice_total), `${fmt.n(S.matched_orders)} matched orders`, `${fmt.n(S.unmatched_orders)} orders with no invoice in file`, pctMatched)}
    </div>
    <article class="card wide"><div class="row"><div><h3>Monthly ordered ${state.chartMode === "gal" ? "gallons" : "diesel spend"}</h3><p class="sub">Line = implied diesel $/gal · dashed = bid estimate pace (600,000 gal ÷ 12)</p></div>
      <div class="seg" id="segM"><button class="${state.chartMode === "gal" ? "on" : ""}" data-m="gal">Gallons</button><button class="${state.chartMode === "usd" ? "on" : ""}" data-m="usd">Diesel $</button></div></div>
      <div id="mChart"></div></article>
    <article class="card wide"><div class="row"><div><h3>Orders to follow up</h3><p class="sub">${follow.length} orders with no posted invoice in the loaded 2026 file, newest first. Not proof they were never invoiced.</p></div><a class="btn ghost" href="#orders">All orders</a></div>
      <div class="tbl-wrap">${ordersTable(follow.slice(0, 8))}</div></article>`;
    drawMonthly();
    $("#segM").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.chartMode = b.dataset.m; $$("#segM button").forEach((x) => x.classList.toggle("on", x === b)); drawMonthly(); };
    $("#segB").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#segB button").forEach((x) => x.classList.toggle("on", x === b));
      const size = b.dataset.m === "size";
      $("#bandChart").innerHTML = bandBars(size ? M.sizeBands(D.orders) : bands);
      $("#bigLbl").textContent = size ? `${fmt.n(S.ordered_gallons / S.orders_count)} gal average order` : "of orders have an invoice in the loaded file";
      $(".big b").innerHTML = size ? `${fmt.n(S.ordered_gallons / S.orders_count)}<small> gal</small>` : `${pctMatched.toFixed(0)}<small>%</small>`;
    };
    wireRows();
  }
  function kpi(label, value, sub, hint, pct) {
    return `<article class="card kpi"><h3>${label}</h3><div class="v">${value}</div><p class="sub">${sub}</p>${meter(pct)}<p class="foot">${hint}</p></article>`;
  }
  function drawMonthly() {
    const P = M.plan(D, state.plan);
    const ms = P.rec.map((m) => (state.chartMode === "gal" ? m : { ...m, gal: m.fuel }));
    $("#mChart").innerHTML = monthly(ms, { price: true, pace: state.chartMode === "gal" ? P.est / 12 : null });
  }

  /* ---------- orders table + drawer ---------- */
  function badge(o) {
    if (o.difference_class === "invoice_not_in_loaded_file") return `<span class="pill p-degraded">No invoice in file</span>`;
    if (o.difference_class === "exact_match") return `<span class="pill p-optimal">Exact</span>`;
    return Math.abs(o.difference) >= 25 ? `<span class="pill p-critical">≥ $25 gap</span>` : `<span class="pill p-good">Within $1</span>`;
  }
  function ordersTable(rows) {
    return `<table class="tbl"><thead><tr><th>PO</th><th>Listed date</th><th>Mode</th><th class="r">Gallons</th><th class="r">PO total</th><th class="r">Invoice</th><th>Check</th></tr></thead><tbody>${rows
      .map((o) => `<tr data-po="${esc(o.po_id)}" tabindex="0"><td><b>${esc(o.po_id)}</b></td><td>${esc(fmt.date(o.listed_date))}</td><td>${esc(o.mode)}</td><td class="r">${fmt.n(o.ordered_gallons)}</td><td class="r">${fmt.usd2(o.po_total)}</td><td class="r">${o.invoice_total == null ? "—" : fmt.usd2(o.invoice_total)}</td><td>${badge(o)}</td></tr>`).join("")}</tbody></table>`;
  }
  function wireRows(root = document) {
    $$("tr[data-po]", root).forEach((tr) => {
      const open = () => showOrder(tr.dataset.po);
      tr.onclick = open; tr.onkeydown = (e) => { if (e.key === "Enter") open(); };
    });
  }
  function showOrder(id) {
    const o = D.orders.find((x) => x.po_id === id); if (!o) return;
    $("#dlgBody").innerHTML = `<div class="row"><div><h2>${esc(o.po_id)}</h2><p class="sub">Listed ${esc(fmt.date(o.listed_date))} · ${esc(o.mode)}</p></div>${badge(o)}</div>
      <div class="kv"><div><span>Ordered gallons</span><b>${fmt.n(o.ordered_gallons)}</b></div><div><span>Diesel line</span><b>${fmt.usd2(o.po_fuel_amount)}</b></div><div><span>Tax lines</span><b>${fmt.usd2(o.po_tax_amount)}</b></div><div><span>Other lines</span><b>${fmt.usd2(o.po_other_amount)}</b></div><div><span>PO total</span><b>${fmt.usd2(o.po_total)}</b></div><div><span>Invoice total</span><b>${o.invoice_total == null ? "none in file" : fmt.usd2(o.invoice_total)}</b></div></div>
      ${o.review_reasons.length ? `<ul class="reasons">${o.review_reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      <h4>PO lines</h4><table class="tbl sm"><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>${o.po_lines.map((l) => `<tr><td>${l.line_number}</td><td>${esc(l.description)}<br><small>${esc(l.category)}</small></td><td class="r">${fmt.n(l.ordered_qty)}</td><td class="r">${fmt.usd2(l.amount)}</td></tr>`).join("")}</tbody></table>
      ${o.invoices.length ? `<h4>Posted invoices</h4><table class="tbl sm"><tbody>${o.invoices.map((i) => `<tr><td><b>${esc(i.invoice_id)}</b></td><td>${esc(fmt.date(i.invoice_date))}</td><td class="r">${fmt.usd2(i.amount)}</td></tr>`).join("")}</tbody></table>` : ""}
      <p class="foot">Source files: ${o.source_files.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ")}</p>`;
    $("#dlg").showModal();
  }
  function orders() {
    $("#view").innerHTML = `<article class="card wide"><div class="row"><div><h3>All orders</h3><p class="sub" id="oCount"></p></div></div>
      <div class="filters"><input id="oq" type="search" placeholder="Search PO number or description" value="${esc(state.orders.q)}" aria-label="Search orders"><div class="seg" id="oSt">${[["all", "All"], ["follow", "Follow up"], ["matched", "Matched"]].map(([k, l]) => `<button data-m="${k}" class="${state.orders.status === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select id="oSort" aria-label="Sort"><option value="listed_date">Date</option><option value="ordered_gallons">Gallons</option><option value="po_total">PO total</option></select><button class="btn ghost" id="oDir"></button></div>
      <div class="tbl-wrap" id="oTbl"></div><div class="pager"><button class="btn ghost" id="oPrev">Previous</button><span id="oPg"></span><button class="btn ghost" id="oNext">Next</button></div></article>`;
    $("#oSort").value = state.orders.sort;
    const draw = () => {
      const st = state.orders, q = st.q.trim().toLowerCase();
      let r = D.orders.filter((o) => (st.status === "all" || (st.status === "follow" ? o.invoice_total == null : o.invoice_total != null)) && (!q || o.po_id.toLowerCase().includes(q) || o.po_lines.some((l) => l.description.toLowerCase().includes(q))));
      r.sort((a, b) => (a[st.sort] > b[st.sort] ? 1 : a[st.sort] < b[st.sort] ? -1 : 0) * st.dir);
      const per = 12, pages = Math.max(1, Math.ceil(r.length / per)); st.page = Math.min(st.page, pages - 1);
      $("#oTbl").innerHTML = r.length ? ordersTable(r.slice(st.page * per, st.page * per + per)) : `<p class="empty">No orders match.</p>`;
      $("#oCount").textContent = `${fmt.n(r.length)} of ${fmt.n(D.orders.length)} orders`;
      $("#oPg").textContent = `Page ${st.page + 1} of ${pages}`;
      $("#oPrev").disabled = st.page === 0; $("#oNext").disabled = st.page >= pages - 1;
      $("#oDir").textContent = st.dir < 0 ? "Newest / high first ↓" : "Oldest / low first ↑";
      wireRows($("#oTbl"));
    };
    $("#oq").oninput = (e) => { state.orders.q = e.target.value; state.orders.page = 0; draw(); };
    $("#oSt").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.orders.status = b.dataset.m; state.orders.page = 0; $$("#oSt button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    $("#oSort").onchange = (e) => { state.orders.sort = e.target.value; draw(); };
    $("#oDir").onclick = () => { state.orders.dir *= -1; draw(); };
    $("#oPrev").onclick = () => { state.orders.page--; draw(); };
    $("#oNext").onclick = () => { state.orders.page++; draw(); };
    draw();
  }

  /* ---------- planner ---------- */
  const FIELD = (id, label, hint, input) => `<label class="fld" for="${id}"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ""}</label>`;
  function planner() {
    const s = state.plan, P0 = M.plan(D, { ...s, uplift: null });
    $("#view").innerHTML = `<div class="grid g-plan"><aside class="card ctrl"><h3>Assumptions</h3>
      <div class="presets">${Object.entries(M.PRESETS).map(([k, p]) => `<button class="btn ghost" data-p="${k}">${p.label}</button>`).join("")}<button class="btn ghost" data-p="reset">Reset</button></div>
      ${FIELD("f_method", "Volume baseline", "Which recorded months set monthly gallons", `<select id="f_method"><option value="l6">Last 6 months</option><option value="l3">Last 3 months</option><option value="ytd">All recorded months</option></select>`)}
      ${FIELD("f_vol", `Volume adjustment <b id="v_vol"></b>`, "", `<input id="f_vol" type="range" min="-30" max="30" step="1">`)}
      ${FIELD("f_pm", "Diesel price source", "", `<select id="f_pm"><option value="implied">Implied, last 3 months</option><option value="manual">Manual $/gal</option></select>`)}
      ${FIELD("f_pr", "Manual price ($/gal)", "", `<input id="f_pr" type="number" min="0" step="0.05">`)}
      ${FIELD("f_sh", `Price shock <b id="v_sh"></b>`, "", `<input id="f_sh" type="range" min="-30" max="40" step="1">`)}
      ${FIELD("f_up", "Tax / biodiesel / other uplift (%)", `Derived from data: ${P0.upliftDerived.toFixed(1)}%`, `<input id="f_up" type="number" min="0" max="200" step="0.5">`)}
      ${FIELD("f_bd", "Monthly budget cap ($, 0 = none)", "Months above it are flagged", `<input id="f_bd" type="number" min="0" step="1000">`)}
      ${FIELD("f_bn", `Forecast range <b id="v_bn"></b>`, "Whisker = ± σ of recorded monthly gallons", `<input id="f_bn" type="range" min="0" max="2" step="0.5">`)}
    </aside><div id="planOut" class="stack"></div></div>`;
    const set = () => {
      $("#f_method").value = s.method; $("#f_vol").value = s.volAdj; $("#f_pm").value = s.priceMode; $("#f_pr").value = s.priceManual; $("#f_sh").value = s.priceShock;
      $("#f_up").value = s.uplift == null ? "" : s.uplift; $("#f_up").placeholder = P0.upliftDerived.toFixed(1); $("#f_bd").value = s.budget; $("#f_bn").value = s.band;
      $("#f_pr").disabled = s.priceMode !== "manual";
      $("#v_vol").textContent = (s.volAdj > 0 ? "+" : "") + s.volAdj + "%"; $("#v_sh").textContent = (s.priceShock > 0 ? "+" : "") + s.priceShock + "%"; $("#v_bn").textContent = "± " + s.band + " σ";
    };
    const bind = (id, key, conv = Number) => { $("#" + id).addEventListener("input", (e) => { const v = e.target.value; s[key] = key === "uplift" && v === "" ? null : conv(v); persist(); set2(); }); };
    const set2 = () => { $("#f_pr").disabled = s.priceMode !== "manual"; $("#v_vol").textContent = (s.volAdj > 0 ? "+" : "") + s.volAdj + "%"; $("#v_sh").textContent = (s.priceShock > 0 ? "+" : "") + s.priceShock + "%"; $("#v_bn").textContent = "± " + s.band + " σ"; planOut(); };
    [["f_method", "method", String], ["f_vol", "volAdj"], ["f_pm", "priceMode", String], ["f_pr", "priceManual"], ["f_sh", "priceShock"], ["f_up", "uplift"], ["f_bd", "budget"], ["f_bn", "band"]].forEach(([i, k, c]) => bind(i, k, c));
    $(".presets").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.p === "reset") Object.assign(s, M.DEFAULTS); else Object.assign(s, { volAdj: M.PRESETS[b.dataset.p].volAdj, priceShock: M.PRESETS[b.dataset.p].priceShock });
      persist(); set(); planOut();
    };
    set(); planOut();
  }
  function planOut() {
    const P = M.plan(D, state.plan), s = P.s;
    $("#planOut").innerHTML = `
    <div class="grid g-kpi4">
      ${kpi("Forecast gallons", fmt.n(P.fcGal), `${esc(fmt.month(P.fc[0].ym))} → ${esc(fmt.month(P.fc[P.fc.length - 1].ym))}`, `${fmt.n(P.base * (1 + s.volAdj / 100))} gal / month`, 60)}
      ${kpi("Forecast diesel $", fmt.usd(P.fcFuel), `at ${fmt.usd2(P.price)}/gal`, s.priceShock ? `${s.priceShock > 0 ? "+" : ""}${s.priceShock}% price shock applied` : "no price shock", 55)}
      ${kpi("Forecast full PO $", fmt.usd(P.fcTotal), `+${P.uplift.toFixed(1)}% tax / biodiesel / other`, `peak ${esc(fmt.month(P.peak.ym))}: ${fmt.usd(P.peak.total)}`, 70)}
      ${kpi("Bid estimate used", fmt.pct(P.winShare), `${fmt.n(P.winGal)} gal in 12 mo to term end`, `of ${fmt.n(P.est)} gal/yr (all fuel types)`, P.winShare)}
    </div>
    ${s.budget > 0 ? `<p class="note ${P.overMonths ? "warn" : ""}">${P.overMonths ? `${P.overMonths} of ${P.fc.length} forecast months exceed the ${fmt.usd(s.budget)} monthly cap.` : `All ${P.fc.length} forecast months are within the ${fmt.usd(s.budget)} monthly cap.`}</p>` : ""}
    <article class="card wide"><h3>Recorded and forecast gallons</h3><p class="sub">Solid = recorded orders · dashed = forecast with ±${s.band} σ whisker · dashed line = bid estimate pace</p>${monthly([...P.rec, ...P.fc], { pace: P.est / 12, paceLabel: "estimate pace" })}</article>
    <article class="card wide"><div class="row"><h3>Forecast schedule</h3><a class="btn" href="#report">Use in report</a></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="r">Orders</th><th class="r">Gallons</th><th class="r">Cumulative</th><th class="r">Diesel $</th><th class="r">Full PO $</th></tr></thead><tbody>${P.fc.map((m) => `<tr class="${m.over ? "over" : ""}"><td>${esc(fmt.month(m.ym, true))}</td><td class="r">${m.orders.toFixed(0)}</td><td class="r">${fmt.n(m.gal)}</td><td class="r">${fmt.n(m.cum)}</td><td class="r">${fmt.usd(m.fuel)}</td><td class="r">${fmt.usd(m.total)}${m.over ? " ▲" : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="foot">Planning model, not a prediction. Seasonality is not modelled: the file holds one partial year. Gallons are order quantities, not deliveries. Price is implied from PO lines, not a contract index.</p></article>`;
  }

  /* ---------- report creator ---------- */
  function reportView() {
    const R = (state.report = { ...Report.defaults(D), ...state.report, sections: { ...Report.defaults(D).sections, ...(state.report.sections || {}) } });
    const labels = { summary: "Position at a glance", monthly: "Monthly activity", match: "Order-to-invoice check", plan: "Fuel buy plan (current Planner settings)", followup: "Orders to follow up", appendix: "Appendix: all orders", sources: "Sources and limits" };
    const opts = D.monthly.map((m) => m.month);
    $("#view").innerHTML = `<div class="grid g-rep"><aside class="card ctrl"><h3>Report</h3>
      ${FIELD("r_t", "Title", "", `<input id="r_t" type="text">`)}${FIELD("r_for", "Prepared for", "", `<input id="r_for" type="text" placeholder="Team or person">`)}${FIELD("r_by", "Prepared by", "", `<input id="r_by" type="text" placeholder="Name">`)}${FIELD("r_d", "Report date", "", `<input id="r_d" type="date">`)}
      <div class="two-f">${FIELD("r_from", "From", "", `<select id="r_from">${opts.map((o) => `<option value="${o}">${fmt.month(o)}</option>`).join("")}</select>`)}${FIELD("r_to", "To", "", `<select id="r_to">${opts.map((o) => `<option value="${o}">${fmt.month(o)}</option>`).join("")}</select>`)}</div>
      ${FIELD("r_n", "Summary note (shown first)", "", `<textarea id="r_n" rows="4" placeholder="What should the reader take from this?"></textarea>`)}
      <fieldset><legend>Sections</legend>${Object.entries(labels).map(([k, l]) => `<label class="chk"><input type="checkbox" data-s="${k}"><span>${l}</span></label>`).join("")}</fieldset>
      <div class="btns"><button class="btn" id="r_dl">Download HTML report</button></div>
      <p class="foot" id="r_msg" role="status">The downloaded file is one self-contained HTML page: no scripts, no network, safe to email or attach.</p></aside>
      <div class="card preview"><div class="row"><h3>Live preview</h3></div><iframe id="r_if" title="Report preview"></iframe></div></div>`;
    const map = { r_t: "title", r_for: "preparedFor", r_by: "preparedBy", r_d: "date", r_from: "from", r_to: "to", r_n: "notes" };
    Object.entries(map).forEach(([id, k]) => { const el = $("#" + id); el.value = R[k]; el.addEventListener("input", () => { R[k] = el.value; if (R.from > R.to) { if (k === "from") R.to = R.from; else R.from = R.to; $("#r_from").value = R.from; $("#r_to").value = R.to; } persist(); draw(); }); });
    $$("[data-s]").forEach((c) => { c.checked = !!R.sections[c.dataset.s]; c.onchange = () => { R.sections[c.dataset.s] = c.checked; persist(); draw(); }; });
    let t; const draw = () => { clearTimeout(t); t = setTimeout(() => { $("#r_if").srcdoc = html(); }, 120); };
    const html = () => Report.build(D, R, state.plan);
    const slug = () => (R.title || "fuel-report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + R.date + ".html";
    const say = (t) => { $("#r_msg").textContent = t; };
    $("#r_dl").onclick = async () => {
      try {
        const dl = await window.claude?.use?.("downloads");
        if (dl) { await dl.save({ filename: slug(), data: html() }); say("Saved."); return; }
        // Plain browsers (page opened as a local file): normal anchor download.
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html()], { type: "text/html" })); a.download = slug(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (e) { say(e && e.code === "declined" ? "Download cancelled." : "Download is not available in this view."); }
    };
    $("#r_if").srcdoc = html();
  }

  /* ---------- sources ---------- */
  function sources() {
    const c = D.contract, m = D.methodology;
    $("#view").innerHTML = `<div class="stack">
    <article class="card wide"><h3>About this tool</h3><p>West Gas Planner is an unofficial prototype. It turns public purchase-order and invoice records into a planning dashboard and a shareable report. The demo data is the City of Columbus's public 2026 diesel purchasing for one supplier account. It is <b>not Cenovus Energy data</b>, and nothing here represents any company. To use your own records, load a file with the same shape through <b>Settings → Load data</b>.</p></article>
    <article class="card wide"><h3>Contract context</h3><dl class="dl"><dt>Bid</dt><dd><a href="${esc(c.bid_url)}" target="_blank" rel="noopener">${esc(c.rfq)}</a>: about ${fmt.n(c.estimated_annual_gallons)} gal/yr across ultra-low sulfur diesel, biodiesel and non-road diesel. An estimate, not purchases.</dd>
    <dt>Award</dt><dd><a href="${esc(c.award_url)}" target="_blank" rel="noopener">Ordinance 1557-2025</a> to ${esc(c.awarded_vendor)}. The $1 authorization only establishes the contract.</dd>
    <dt>Purchase agreement</dt><dd><a href="${esc(c.authorization_url)}" target="_blank" rel="noopener">${esc(c.agreement)}</a>, vendor ${esc(c.vendor_account)}, ends ${esc(fmt.date(c.term_end))}.</dd><dt>Caveat</dt><dd>${esc(c.association_note)}</dd></dl></article>
    <article class="card wide"><h3>Definitions and limits</h3><dl class="dl">${["scope", "ordered_gallons", "po_total", "invoice_total", "difference", "unmatched", "limits"].map((k) => `<dt>${k.replace(/_/g, " ")}</dt><dd>${esc(m[k])}</dd>`).join("")}<dt>Review threshold</dt><dd>$${m.material_variance_threshold_usd} on the full PO total, either direction.</dd></dl></article>
    <article class="card wide"><h3>Data files</h3><ul class="plain">${D.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>${s.retrieved_at ? `<small> · retrieved ${esc(fmt.date(s.retrieved_at))}</small>` : ""}</li>`).join("")}</ul></article></div>`;
  }

  /* ---------- settings: swap data ---------- */
  function settings() {
    $("#btnSettings").onclick = () => $("#dlgSet").showModal();
    $("#fileIn").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        const ok = j && Array.isArray(j.orders) && Array.isArray(j.monthly) && j.summary && j.contract && j.methodology && Array.isArray(j.sources) && j.orders.every((o) => o.po_id && o.listed_date && o.po_lines && o.source_files);
        if (!ok) throw new Error("Missing orders, monthly, summary, contract, methodology or sources, or an order lacks po_id, listed_date, po_lines or source_files.");
        D = j; state.report = {}; shell(); route(); $("#dlgSet").close();
        $("#dataMsg").textContent = `Loaded ${f.name}: ${j.orders.length} orders.`;
      } catch (err) { $("#dataMsg").textContent = "Could not load: " + err.message; }
      e.target.value = "";
    };
    $("#btnDemo").onclick = () => { D = window.__PLANNER_DATA__; state.report = {}; shell(); route(); $("#dlgSet").close(); };
    $("#btnExport").onclick = () => { location.hash = "#report"; };
    $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
    $$("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  }

  shell(); settings(); window.addEventListener("hashchange", route); route();
})();
