/* Planner maths. Pure functions over the data.json schema; no DOM. */
(function () {
  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  const stdev = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a, (v) => (v - m) ** 2) / (a.length - 1));
  };
  const addMonth = (ym, k) => {
    const [y, m] = ym.split("-").map(Number), t = y * 12 + (m - 1) + k;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  };

  const DEFAULTS = {
    method: "l6", // ytd | l3 | l6 — which recorded months set the baseline volume
    volAdj: 0, // % change applied to baseline gallons
    priceMode: "implied", // implied | manual
    priceManual: 4.5, // $/gal when priceMode = manual
    priceShock: 0, // % change applied to the price
    uplift: null, // % added to fuel $ for biodiesel, additives and tax (null = derive from data)
    budget: 0, // monthly cap on total PO $, 0 = none
    band: 1, // ± this many standard deviations drawn as the forecast range
  };

  /* Orders → 5 Genesis-style bands, worst to best. */
  function matchBands(orders) {
    const c = { gap: 0, none: 0, mid: 0, within: 0, exact: 0 };
    orders.forEach((o) => {
      if (o.difference_class === "invoice_not_in_loaded_file") c.none++;
      else if (o.difference_class === "exact_match") c.exact++;
      else if (Math.abs(o.difference) >= 25) c.gap++;
      else if (Math.abs(o.difference) > 1) c.mid++;
      else c.within++;
    });
    return [
      { name: "≥ $25 gap", sub: "review", value: c.gap },
      { name: "No invoice", sub: "in loaded file", value: c.none },
      { name: "$1 – $25", sub: "difference", value: c.mid },
      { name: "Within $1", sub: "of PO total", value: c.within },
      { name: "Exact", sub: "match", value: c.exact },
    ];
  }

  /* Gallons per order → five size bands (planning view of order cadence). */
  function sizeBands(orders) {
    const edges = [[0, 500, "< 500"], [500, 1000, "500–1k"], [1000, 2000, "1–2k"], [2000, 4000, "2–4k"], [4000, Infinity, "4k +"]];
    return edges.map(([lo, hi, name]) => ({ name, sub: "gallons", value: orders.filter((o) => o.ordered_gallons >= lo && o.ordered_gallons < hi).length }));
  }

  function recorded(D) {
    return D.monthly.map((m) => ({
      ym: m.month, gal: m.ordered_gallons, orders: m.orders_count, fuel: m.po_fuel_amount, total: m.po_total,
      invoice: m.invoice_total, review: m.review_count, price: m.ordered_gallons ? m.po_fuel_amount / m.ordered_gallons : null, forecast: false,
    }));
  }

  /* Forecast every month from the one after the last recorded month to the contract term end. */
  function plan(D, s) {
    s = { ...DEFAULTS, ...s };
    const rec = recorded(D), gals = rec.map((m) => m.gal);
    const base = s.method === "ytd" ? mean(gals) : mean(gals.slice(-(s.method === "l3" ? 3 : 6)));
    const sd = stdev(gals);
    const tot = D.summary;
    const lastN = rec.slice(-3);
    const impliedPrice = sum(lastN, (m) => m.fuel) / sum(lastN, (m) => m.gal);
    const ytdPrice = tot.po_fuel_amount / tot.ordered_gallons;
    const upliftDerived = (tot.po_total / tot.po_fuel_amount - 1) * 100;
    const uplift = s.uplift == null ? upliftDerived : s.uplift;
    const priceBase = s.priceMode === "manual" ? s.priceManual : impliedPrice;
    const price = priceBase * (1 + s.priceShock / 100);
    const avgOrder = tot.ordered_gallons / tot.orders_count;
    const gal = Math.max(0, base * (1 + s.volAdj / 100));
    const last = rec[rec.length - 1].ym, end = D.contract.term_end.slice(0, 7);
    const fc = [];
    for (let ym = addMonth(last, 1); ym <= end; ym = addMonth(ym, 1)) {
      const fuel = gal * price, total = fuel * (1 + uplift / 100);
      fc.push({
        ym, gal, lo: Math.max(0, gal - s.band * sd), hi: gal + s.band * sd, orders: gal / avgOrder, fuel, total, price, forecast: true,
        over: s.budget > 0 && total > s.budget,
      });
    }
    // Next-12-months window ending at term end = last recorded month + forecast.
    const win = [rec[rec.length - 1], ...fc].slice(-12);
    const est = D.contract.estimated_annual_gallons;
    let cum = 0;
    fc.forEach((m) => { cum += m.gal; m.cum = cum; });
    return {
      s, rec, fc, base, sd, price, impliedPrice, ytdPrice, uplift, upliftDerived, avgOrder, est,
      fcGal: sum(fc, (m) => m.gal), fcFuel: sum(fc, (m) => m.fuel), fcTotal: sum(fc, (m) => m.total),
      winGal: sum(win, (m) => m.gal), winLabel: `${win[0].ym} → ${win[win.length - 1].ym}`,
      winShare: (sum(win, (m) => m.gal) / est) * 100,
      peak: fc.reduce((a, b) => (b.total > a.total ? b : a), fc[0]),
      overMonths: fc.filter((m) => m.over).length,
      ytdShare: ((tot.ordered_gallons / rec.length) * 12 / est) * 100,
    };
  }

  const PRESETS = {
    base: { label: "Base", volAdj: 0, priceShock: 0 },
    lean: { label: "Lean", volAdj: -10, priceShock: -10 },
    stress: { label: "Stress", volAdj: 10, priceShock: 15 },
  };

  window.Model = { DEFAULTS, PRESETS, plan, matchBands, sizeBands, recorded, mean, stdev, sum };
})();
