/* Report creator: returns ONE self-contained HTML string (inline CSS + inline SVG,
   no scripts, no network). The same string feeds the live preview, the download
   and the print-to-PDF path. */
(function () {
  const { fmt, esc, gauge, bandBars, monthly, meter, CHART_CSS } = Charts;
  const M = Model;

  const REPORT_CSS = `
  :root{--font:"IBM Plex Sans",-apple-system,"Segoe UI",Roboto,sans-serif;--ink:#1c2024;--ink-2:#4a525b;--ink-3:#7b838c;--line:#e4e6e9;--surface:#fff;--soft:#f5f6f7;
   --accent:#b3202f;--accent-2:#2f6f8f;--band-critical:#d9342b;--band-degraded:#f08a3c;--band-fair:#f4c430;--band-good:#4cc35a;--band-optimal:#12a878}
  *{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{margin:0;background:#eceef0;color:var(--ink);font:14px/1.55 var(--font)}
  .page{max-width:900px;margin:24px auto;background:var(--surface);border-radius:14px;overflow:hidden;box-shadow:0 2px 24px rgba(0,0,0,.08)}
  .cover{padding:40px 44px 30px;color:#fff;background:linear-gradient(120deg,#16191c 0%,#2a1215 60%,#6e1820 100%)}
  .cover .eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7}
  .cover h1{margin:8px 0 6px;font-size:30px;line-height:1.15;font-weight:600}.cover .meta{font-size:13px;opacity:.8}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}.chips span{font-size:11px;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,.14)}
  section{padding:26px 44px;border-top:1px solid var(--line)}section h2{margin:0 0 4px;font-size:18px;font-weight:600}
  .lede{color:var(--ink-2);margin:0 0 16px;max-width:70ch}.notes{white-space:pre-wrap;background:var(--soft);border-left:3px solid var(--accent);padding:12px 16px;border-radius:0 8px 8px 0;margin:0}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.kpi{background:var(--soft);border-radius:12px;padding:14px 16px}
  .kpi b{display:block;font-size:24px;font-weight:600;line-height:1.2}.kpi span{font-size:12px;color:var(--ink-2)}
  .two{display:grid;grid-template-columns:240px 1fr;gap:24px;align-items:center}
  table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;color:var(--ink-3);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
  td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
  tr.fc td{color:var(--ink-2)}tr.over td{color:var(--accent);font-weight:600}
  .assump{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 24px;font-size:13px;margin:0 0 16px}.assump div{display:flex;justify-content:space-between;border-bottom:1px dotted var(--line);padding:4px 0}.assump span{color:var(--ink-2)}
  .legend{display:flex;gap:16px;font-size:12px;color:var(--ink-2);margin:6px 0 0}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-2px;background:var(--accent)}.legend i.f{opacity:.35;border:1.2px dashed var(--accent)}
  .limits li{margin-bottom:6px;color:var(--ink-2)}footer{padding:18px 44px 26px;font-size:11.5px;color:var(--ink-3);border-top:1px solid var(--line)}
  ${CHART_CSS}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}section,.kpi,tr{break-inside:avoid}}
  @media(max-width:640px){.cover,section,footer{padding-left:20px;padding-right:20px}.two{grid-template-columns:1fr}}`;

  function defaults(D) {
    return {
      title: "Diesel buy plan and order review",
      preparedFor: "",
      preparedBy: "",
      date: new Date().toISOString().slice(0, 10),
      notes: "",
      from: D.monthly[0].month,
      to: D.monthly[D.monthly.length - 1].month,
      sections: { summary: true, monthly: true, match: true, plan: true, followup: true, appendix: false, sources: true },
    };
  }

  function build(D, opt, planState) {
    const o = { ...defaults(D), ...opt, sections: { ...defaults(D).sections, ...(opt.sections || {}) } };
    const P = M.plan(D, planState);
    const rec = P.rec.filter((m) => m.ym >= o.from && m.ym <= o.to);
    const orders = D.orders.filter((x) => x.listed_date.slice(0, 7) >= o.from && x.listed_date.slice(0, 7) <= o.to);
    const sec = [];
    const S = o.sections;
    const sumGal = M.sum(rec, (m) => m.gal), sumFuel = M.sum(rec, (m) => m.fuel), sumTot = M.sum(rec, (m) => m.total);
    const matched = orders.filter((x) => x.invoice_total != null), unmatched = orders.filter((x) => x.invoice_total == null);
    const score = orders.length ? (matched.length / orders.length) * 10 : 0;

    if (o.notes.trim()) sec.push(`<section><h2>Summary note</h2><p class="notes">${esc(o.notes)}</p></section>`);

    if (S.summary) sec.push(`<section><h2>Position at a glance</h2><p class="lede">Recorded diesel-coded purchase orders for vendor account ${esc(D.contract.vendor_account)}, ${esc(fmt.month(o.from, true))} to ${esc(fmt.month(o.to, true))}.</p>
      <div class="kpis"><div class="kpi"><b>${fmt.n(orders.length)}</b><span>purchase orders</span></div>
      <div class="kpi"><b>${fmt.n(sumGal)}</b><span>ordered gallons (inferred unit)</span></div>
      <div class="kpi"><b>${fmt.usd(sumFuel)}</b><span>main diesel line amount</span></div>
      <div class="kpi"><b>${fmt.usd(sumTot)}</b><span>full PO total (incl. tax, other lines)</span></div>
      <div class="kpi"><b>${sumGal ? fmt.usd2(sumFuel / sumGal) : "n/a"}</b><span>implied diesel $/gal</span></div>
      <div class="kpi"><b>${fmt.n(unmatched.length)}</b><span>orders to follow up</span></div></div></section>`);

    if (S.monthly) sec.push(`<section><h2>Monthly activity</h2><p class="lede">Gallons are grouped by the listed purchase-order date. The line is the implied diesel price (main diesel line amount ÷ ordered gallons).</p>
      ${monthly(rec, { price: true, pace: P.est / 12, paceLabel: "600k/yr estimate pace" })}
      <table style="margin-top:10px"><thead><tr><th>Month</th><th class="r">Orders</th><th class="r">Gallons</th><th class="r">Diesel $</th><th class="r">PO total</th><th class="r">$/gal</th><th class="r">To follow up</th></tr></thead><tbody>
      ${rec.map((m) => `<tr><td>${esc(fmt.month(m.ym, true))}</td><td class="r">${fmt.n(m.orders)}</td><td class="r">${fmt.n(m.gal)}</td><td class="r">${fmt.usd(m.fuel)}</td><td class="r">${fmt.usd(m.total)}</td><td class="r">${m.price ? fmt.usd2(m.price) : "n/a"}</td><td class="r">${fmt.n(m.review)}</td></tr>`).join("")}</tbody></table></section>`);

    if (S.match) sec.push(`<section><h2>Order-to-invoice check</h2><p class="lede">${fmt.n(matched.length)} of ${fmt.n(orders.length)} orders have a posted invoice in the loaded 2026 journal. No match means “not in the loaded file”, not “never invoiced”; an invoice may post in another year. A $25 gap or more is queued for review.</p>
      <div class="two"><div style="text-align:center">${gauge(score)}<div style="font-size:12px;color:var(--ink-2)">Match score = matched orders ÷ orders × 10</div></div>${bandBars(M.matchBands(orders))}</div></section>`);

    if (S.plan) {
      const s = P.s;
      sec.push(`<section><h2>Fuel buy plan to contract end</h2><p class="lede">Forward plan for ${esc(fmt.month(P.fc[0].ym, true))} through ${esc(fmt.month(P.fc[P.fc.length - 1].ym, true))}. This is a planning model driven by the assumptions below, not a prediction or a contract price.</p>
      <div class="assump">
       <div><span>Volume baseline</span><b>${{ ytd: "Average of all recorded months", l3: "Last 3 recorded months", l6: "Last 6 recorded months" }[s.method]} · ${fmt.n(P.base)} gal/mo</b></div>
       <div><span>Volume adjustment</span><b>${s.volAdj > 0 ? "+" : ""}${s.volAdj}%</b></div>
       <div><span>Diesel price</span><b>${fmt.usd2(P.price)}/gal${s.priceMode === "manual" ? " (manual)" : " (last-3-month implied)"}${s.priceShock ? `, ${s.priceShock > 0 ? "+" : ""}${s.priceShock}% shock` : ""}</b></div>
       <div><span>Tax / biodiesel / other uplift</span><b>${P.uplift.toFixed(1)}% on diesel $</b></div>
       <div><span>Average order size</span><b>${fmt.n(P.avgOrder)} gal</b></div>
       <div><span>Monthly budget cap</span><b>${s.budget > 0 ? fmt.usd(s.budget) : "none set"}</b></div></div>
      <div class="kpis" style="margin-bottom:14px"><div class="kpi"><b>${fmt.n(P.fcGal)}</b><span>forecast gallons</span></div><div class="kpi"><b>${fmt.usd(P.fcFuel)}</b><span>forecast diesel line $</span></div>
       <div class="kpi"><b>${fmt.usd(P.fcTotal)}</b><span>forecast full PO $</span></div><div class="kpi"><b>${P.winShare.toFixed(0)}%</b><span>of ${fmt.n(P.est)} gal/yr bid estimate (12 mo to term end)</span></div></div>
      ${monthly([...P.rec.slice(-6), ...P.fc], { pace: P.est / 12, paceLabel: "estimate pace" })}
      <div class="legend"><span><i></i>Recorded</span><span><i class="f"></i>Forecast (whisker = ±${s.band} σ of recorded months)</span></div>
      <table style="margin-top:12px"><thead><tr><th>Month</th><th class="r">Orders</th><th class="r">Gallons</th><th class="r">Cumulative</th><th class="r">Diesel $</th><th class="r">PO total</th></tr></thead><tbody>
      ${P.fc.map((m) => `<tr class="fc${m.over ? " over" : ""}"><td>${esc(fmt.month(m.ym, true))}</td><td class="r">${m.orders.toFixed(0)}</td><td class="r">${fmt.n(m.gal)}</td><td class="r">${fmt.n(m.cum)}</td><td class="r">${fmt.usd(m.fuel)}</td><td class="r">${fmt.usd(m.total)}${m.over ? " ▲ over cap" : ""}</td></tr>`).join("")}</tbody></table></section>`);
    }

    if (S.followup) sec.push(`<section><h2>Orders to follow up</h2><p class="lede">${fmt.n(unmatched.length)} order${unmatched.length === 1 ? "" : "s"} with no posted invoice in the loaded file, newest first.</p>
      ${unmatched.length ? `<table><thead><tr><th>PO</th><th>Listed date</th><th>Mode</th><th class="r">Gallons</th><th class="r">PO total</th></tr></thead><tbody>${[...unmatched].sort((a, b) => b.listed_date.localeCompare(a.listed_date)).map((x) => `<tr><td>${esc(x.po_id)}</td><td>${esc(fmt.date(x.listed_date))}</td><td>${esc(x.mode)}</td><td class="r">${fmt.n(x.ordered_gallons)}</td><td class="r">${fmt.usd2(x.po_total)}</td></tr>`).join("")}</tbody></table>` : "<p>None in this range.</p>"}</section>`);

    if (S.appendix) sec.push(`<section><h2>Appendix: all orders</h2><table><thead><tr><th>PO</th><th>Date</th><th class="r">Gallons</th><th class="r">PO total</th><th class="r">Invoice</th><th class="r">Diff</th></tr></thead><tbody>${orders.map((x) => `<tr><td>${esc(x.po_id)}</td><td>${esc(x.listed_date)}</td><td class="r">${fmt.n(x.ordered_gallons)}</td><td class="r">${fmt.usd2(x.po_total)}</td><td class="r">${x.invoice_total == null ? "none" : fmt.usd2(x.invoice_total)}</td><td class="r">${x.difference == null ? "n/a" : fmt.usd2(x.difference)}</td></tr>`).join("")}</tbody></table></section>`);

    if (S.sources) sec.push(`<section class="limits"><h2>Sources and limits</h2><ul class="limits">
      <li><b>Source:</b> ${D.sources.filter((s) => s.retrieved_at).map((s) => esc(s.label)).join("; ")}; retrieved ${esc(fmt.date(D.as_of))}.</li>
      <li><b>Gallons</b> are purchase-order quantities on main diesel lines, interpreted as gallons (the export has no unit field). They are not delivered volumes.</li>
      <li><b>PO totals</b> include tax, biodiesel, additive and other lines. They are not diesel-only spend.</li>
      <li><b>Contract context:</b> ${esc(D.contract.agreement)} with ${esc(D.contract.awarded_vendor)}, term end ${esc(fmt.date(D.contract.term_end))}. ${esc(D.contract.association_note)}</li>
      <li>${esc(D.methodology.limits)}</li></ul></section>`);

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title><style>${REPORT_CSS}</style></head><body><div class="page">
    <header class="cover"><div class="eyebrow">West Gas Planner · Fuel buy report</div><h1>${esc(o.title)}</h1>
    <div class="meta">${o.preparedFor ? `Prepared for ${esc(o.preparedFor)} · ` : ""}${o.preparedBy ? `by ${esc(o.preparedBy)} · ` : ""}${esc(fmt.date(o.date))}</div>
    <div class="chips"><span>Vendor acct ${esc(D.contract.vendor_account)}</span><span>${esc(fmt.month(o.from, true))} – ${esc(fmt.month(o.to, true))}</span><span>Data snapshot ${esc(fmt.date(D.as_of))}</span></div></header>
    ${sec.join("\n")}
    <footer>Generated by West Gas Planner, an unofficial prototype. Demo data: City of Columbus public purchase-order and invoice records for one supplier; this is not Cenovus Energy data and does not represent any company. Figures are record comparisons, not audit findings.</footer></div></body></html>`;
  }

  window.Report = { build, defaults };
})();
