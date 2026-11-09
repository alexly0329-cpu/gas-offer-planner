/* Shared formatters + pure SVG chart builders. Used by the dashboard AND the
   self-contained HTML report, so every chart returns a string and depends only
   on the CSS variables / classes in CHART_CSS. */
(function () {
  const nf = new Intl.NumberFormat("en-US");
  const fmt = {
    n: (v) => (v == null ? "n/a" : nf.format(Math.round(v))),
    usd: (v) => (v == null ? "n/a" : (v < 0 ? "-$" : "$") + nf.format(Math.round(Math.abs(v)))),
    usd2: (v) => (v == null ? "n/a" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    k: (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + "k" : String(Math.round(v))),
    pct: (v, d = 0) => (v == null ? "n/a" : v.toFixed(d) + "%"),
    month: (ym, long) => {
      const [y, m] = ym.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" }).replace(/ (\d\d)$/, " ’$1");
    },
    date: (iso) => (iso ? new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "n/a"),
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const BANDS = [
    { key: "critical", cls: "b-critical", color: "var(--band-critical)" },
    { key: "degraded", cls: "b-degraded", color: "var(--band-degraded)" },
    { key: "fair", cls: "b-fair", color: "var(--band-fair)" },
    { key: "good", cls: "b-good", color: "var(--band-good)" },
    { key: "optimal", cls: "b-optimal", color: "var(--band-optimal)" },
  ];

  /* 0–10 semicircle gauge in five Genesis-style bands. */
  function gauge(score) {
    const cx = 120, cy = 118, r = 92, w = 20;
    const pt = (a, rad) => [cx + rad * Math.cos(Math.PI - a), cy - rad * Math.sin(Math.PI - a)];
    const arc = (a0, a1) => {
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
      return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    };
    const s = Math.max(0, Math.min(10, score));
    let segs = "";
    BANDS.forEach((b, i) => {
      const a0 = (i / 5) * Math.PI + 0.012, a1 = ((i + 1) / 5) * Math.PI - 0.012;
      const lit = s >= (i + 1) * 2 ? 1 : s > i * 2 ? 1 : 0;
      segs += `<path d="${arc(a0, a1)}" stroke="${b.color}" stroke-width="${w}" fill="none" stroke-linecap="butt" opacity="${lit ? 1 : 0.22}"/>`;
    });
    const na = (s / 10) * Math.PI, [nx, ny] = pt(na, r + 10), [bx, by] = pt(na, r - w - 6);
    return `<svg class="gauge" viewBox="0 0 240 140" role="img" aria-label="Score ${s.toFixed(1)} out of 10">
      ${segs}
      <line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
      <text x="${cx}" y="${cy - 22}" text-anchor="middle" class="g-score">${s.toFixed(1)}</text>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="g-label">${s >= 8 ? "OPTIMAL" : s >= 6 ? "GOOD" : s >= 4 ? "FAIR" : s >= 2 ? "DEGRADED" : "CRITICAL"}</text>
      <text x="${cx - r}" y="${cy + 16}" text-anchor="middle" class="g-tick">0</text>
      <text x="${cx + r}" y="${cy + 16}" text-anchor="middle" class="g-tick">10</text></svg>`;
  }

  /* Five coloured columns, Genesis "proportion of healthy soils" style. */
  function bandBars(items) {
    const W = 520, H = 230, padB = 44, top = 24, bw = 74, gap = (W - bw * items.length) / (items.length + 1);
    const max = Math.max(1, ...items.map((i) => i.value));
    let out = "";
    items.forEach((it, i) => {
      const b = BANDS[i], x = gap + i * (bw + gap), hgt = it.value ? Math.max(3, ((H - padB - top) * it.value) / max) : 2;
      const y = H - padB - hgt;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${hgt.toFixed(1)}" rx="${it.value ? 4 : 1}" fill="${b.color}"/>
        <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" class="bb-val">${fmt.n(it.value)}</text>
        <text x="${(x + bw / 2).toFixed(1)}" y="${H - 24}" text-anchor="middle" class="bb-name">${esc(it.name)}</text>
        <text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="bb-sub">${esc(it.sub)}</text>`;
    });
    return `<svg class="bandbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Orders by invoice check">${out}</svg>`;
  }

  /* Monthly gallons: solid = recorded, hatched = forecast (with ±σ whisker).
     opts.price draws the implied $/gal line on a right axis; opts.pace a dashed
     reference line (gallons per month implied by the contract estimate). */
  function monthly(months, opts = {}) {
    const W = 760, H = 300, L = 52, R = opts.price ? 52 : 14, T = 18, B = 40;
    const iw = W - L - R, ih = H - T - B, n = months.length, step = iw / n, bw = Math.min(40, step * 0.62);
    const yMaxRaw = Math.max(...months.map((m) => (m.hi ?? m.gal) || 0), opts.pace || 0, 1);
    const tick = niceStep(yMaxRaw / 4), yMax = Math.ceil(yMaxRaw / tick) * tick;
    const y = (v) => T + ih - (v / yMax) * ih;
    let g = "";
    for (let v = 0; v <= yMax + 1e-6; v += tick) g += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="axis">${fmt.k(v)}</text>`;
    let bars = "", lab = "";
    months.forEach((m, i) => {
      const cx = L + step * i + step / 2, x = cx - bw / 2, top = y(m.gal);
      bars += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ih - top).toFixed(1)}" rx="3" class="${m.forecast ? "bar-fc" : "bar"}"><title>${esc(fmt.month(m.ym, true))}: ${fmt.n(m.gal)} gal${m.forecast ? " (forecast)" : ""}</title></rect>`;
      if (m.forecast && m.lo != null) bars += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(m.hi).toFixed(1)}" y2="${y(Math.max(0, m.lo)).toFixed(1)}" class="whisker"/><line x1="${(cx - 5).toFixed(1)}" x2="${(cx + 5).toFixed(1)}" y1="${y(m.hi).toFixed(1)}" y2="${y(m.hi).toFixed(1)}" class="whisker"/><line x1="${(cx - 5).toFixed(1)}" x2="${(cx + 5).toFixed(1)}" y1="${y(Math.max(0, m.lo)).toFixed(1)}" y2="${y(Math.max(0, m.lo)).toFixed(1)}" class="whisker"/>`;
      if (n <= 14 || i % 2 === 0) lab += `<text x="${cx.toFixed(1)}" y="${H - 18}" text-anchor="middle" class="axis">${esc(fmt.month(m.ym).split(" ")[0])}</text>` + (m.ym.endsWith("-01") || i === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle" class="axis axis-y">${m.ym.slice(0, 4)}</text>` : "");
    });
    let extra = "";
    if (opts.pace) extra += `<line x1="${L}" x2="${W - R}" y1="${y(opts.pace).toFixed(1)}" y2="${y(opts.pace).toFixed(1)}" class="pace"/><text x="${L + 6}" y="${(y(opts.pace) - 6).toFixed(1)}" text-anchor="start" class="pace-t">${esc(opts.paceLabel || "Estimate pace")}</text>`;
    if (opts.price) {
      const ps = months.map((m) => m.price).filter((v) => v != null), pMax = Math.ceil(Math.max(...ps)), pMin = Math.floor(Math.min(...ps) - 0.5);
      const py = (v) => T + ih - ((v - pMin) / (pMax - pMin || 1)) * ih;
      const pts = months.map((m, i) => (m.price == null ? null : [L + step * i + step / 2, py(m.price)])).filter(Boolean);
      extra += `<polyline points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" class="priceline"/>` + pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" class="pricedot"/>`).join("");
      for (let v = pMin; v <= pMax; v++) extra += `<text x="${W - R + 8}" y="${(py(v) + 4).toFixed(1)}" class="axis axis-p">$${v}</text>`;
    }
    return `<svg class="monthly" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly ordered gallons">${g}${bars}${extra}${lab}</svg>`;
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  /* Horizontal meter, like Genesis' water/biodiversity bars. */
  function meter(pct) {
    return `<div class="meter"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>`;
  }

  const CHART_CSS = `
  .gauge{width:100%;max-width:260px}.g-score{font:600 38px var(--font);fill:var(--ink)}.g-label{font:600 11px var(--font);letter-spacing:.08em;fill:var(--ink-2)}.g-tick{font:11px var(--font);fill:var(--ink-3)}
  .bandbars{width:100%;height:auto}.bb-val{font:500 13px var(--font);fill:var(--ink)}.bb-name{font:600 12px var(--font);fill:var(--ink)}.bb-sub{font:11px var(--font);fill:var(--ink-3)}
  .monthly{width:100%;height:auto}.grid{stroke:var(--line);stroke-width:1}.axis{font:11px var(--font);fill:var(--ink-3)}.axis-y{fill:var(--ink-2);font-weight:600}.axis-p{fill:var(--accent-2)}
  .bar{fill:var(--accent)}.bar-fc{fill:var(--accent);opacity:.32;stroke:var(--accent);stroke-width:1.2;stroke-dasharray:4 3}
  .whisker{stroke:var(--ink-2);stroke-width:1.3}.pace{stroke:var(--ink-2);stroke-width:1.4;stroke-dasharray:6 5}.pace-t{font:600 11px var(--font);fill:var(--ink-2)}
  .priceline{fill:none;stroke:var(--accent-2);stroke-width:2.2}.pricedot{fill:var(--surface);stroke:var(--accent-2);stroke-width:2}
  .meter{height:6px;border-radius:99px;background:var(--line);overflow:hidden}.meter i{display:block;height:100%;background:var(--ink);border-radius:99px}`;

  window.Charts = { fmt, esc, BANDS, gauge, bandBars, monthly, meter, CHART_CSS };
})();
