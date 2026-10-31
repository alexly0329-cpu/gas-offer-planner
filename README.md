# Project 2 — Gas Offer Planner

A Streamlit portfolio app for a supplier quoting fixed monthly natural-gas blocks to an HVAC equipment manufacturer using an estimated operating profile. It demonstrates price, hedge planning, weather/price scenarios, cash timing, credit exposure and anonymous PDF proposals.

**Hosting status:** this is the working Python reference version. Netlify is the intended target, but the app needs conversion before it can run there. See [deployment notes](DEPLOYMENT.md) and [data-release notes](DATA_SOURCES.md).

## Open

Open http://127.0.0.1:8501 while the local server is running. To restart on a Mac, double-click **Start.command**. The portable launcher creates `.venv` and installs `requirements.txt` when needed. The verified environment is Python 3.12 with the pinned package versions. Initial installation needs internet. Local calculations and PDF creation then work offline; the launcher listens only on this computer. A hosted Streamlit deployment instead processes inputs on its Python server and requires a network connection.

Manual start:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m streamlit run app.py --server.address=127.0.0.1 --server.port=8501 --browser.gatherUsageStats=false
```

## Guided walkthrough

The animated sequence follows six steps in order. Each screen explains the required information and why it matters. Back and previously reached steps preserve your entries.

1. **Customer:** enter an internal label, choose city and12/24-month term. Delivery starts January2027. The PDF stays anonymous.
2. **Gas use & weather:** keep the locked6,100MMBtu benchmark or select User-entered annual total to provide another quantity. Adjust assumed HDD. New offers reprice; saved offers keep their agreed blocks and price.
3. **Market prices:** supply Henry Hub plus matching regional basis for every delivery month. Record the source and valuation date. Tulsa2027has a bundled reference; othercities/2028need their own prices. Missing prices can proceed Pending; invalid values/dates must be corrected or cleared.
4. **Supplier costs:** enter margin, fuel and the existing cost allowances. Add customer and supplier payment days after a month-end invoice to calculate operating cash needs. Unknown values stay Pending; zero is deliberate. Saved-offer tests retain original costs and payment terms.
5. **Credit:** enter financial amounts or ratios. Optional exposure details add an approved unsecured limit and a separate estimate for unbilled/close-out exposure. A strong score does not create an unlimited credit line.
6. **Review & PDF:** inspect the offer, simple financial plan, monthly hedge check and credit exposure. Download a short customer proposal or the more detailed internal financial review. Both remain anonymous.

The default Tulsa+20%HDDcase produces6,588MMBtu, a$3.0171/MMBtu partial subtotal and$19,876.64 fixed-block subtotal. The customer PDF is2pages for12months and3for24; the internal PDF is4and5pages respectively. Missing costs, payment terms and financials remain Pending. New-offer blocks are proposed quantities, not a signed commitment.

## Simple financial plan

The Financial plan tab shows monthly revenue, budgeted costs, contribution, break-even block price and peak operating cash needed. It reuses the offer's supplied cost allowances, including financing and risk reserves; these are budget amounts, not audited expenses or net income. With missing market/cost inputs, full financial values remain Pending.

Both invoices are assumed to be issued at the end of the delivery month. Customer and supplier payment days determine cash dates. Funding starts from zero cash and uses the lowest event-date balance, so paying a supplier before collecting in the same month still creates a funding need. The monthly table includes collections/payments after the delivery term. A separate0–90day customer-delay check changes cash timing only. Same-day cash flows are netted. Daily hedge collateral and future price-driven hedge settlements are outside this simple operating cash plan; reference settlements are zero at the entered indices.

Credit exposure is peak positive billed receivables plus the user-entered additional exposure estimate. Invoice amounts are counted before same-day collections. The coverage gap is exposure less the permitted unsecured limit, floored at zero. The entered limit is permitted only when the ratio score is6/6 with no flags; otherwise the current conservative policy uses zero. A missing limit for strong credit or missing additional exposure leaves the gap Pending. This is an estimate to review, not final collateral approval, PD or LGD. The payment-delay check changes funding only; billed exposure uses the base payment terms.

The market step also records an internal delivery point/index, confirmation and quote-valid-until date. Review status separates complete cost assumptions from outstanding commercial checks. Monthly customer bills and matching weather are still needed to validate demand; an annual total alone does not validate the seasonal profile.

## Pricing boundary

The customer agrees fixed monthly blocks, with deviations settled at the matching regional monthly index in the base model. This is not a requirements contract that fixes the price of all actual usage.

For each month, quantity equals steady gas plus reference heating gas multiplied by `(1 + HDD adjustment)`. The default benchmark splits annual gas 60% steady / 40% weather sensitive. A new offer weights monthly Henry Hub plus regional basis by those blocks, then adds the known costs and selected margin. The fixed-block subtotal is price times contracted blocks; indexed deviations, utility transport, taxes and omitted items change the actual customer bill.

The $0.20/MMBtu default margin is a target contribution before unmodeled costs, not net profit. Fuel, supplier fees, financing, residual risk and credit allowance start unknown. Enter zero only deliberately. Fuel on receipts uses `q/(1-f)`; fuel on customer deliveries uses `q*(1+f)`. Both price-component hedge legs use the same gross quantity when fuel is supplied. They must not be added as if they were separate gas volumes.

Only Tulsa calendar 2027 has a bundled market reference. It combines October 29, 2026 Henry Hub settlements with a regional pipeline basis proxy whose date was corroborated against three dated seasonal averages; the monthly basis file does not print its own valuation date. The selected route is an assumption, not a confirmed factory delivery point. The archive is indicative and may be stale. It is not an executable supplier quote.

Omaha, Columbus (Ohio) and 2028 need their own monthly Henry Hub and regional basis inputs. Missing prices produce Pending, never unverified extrapolations. Use the market tab to edit the curve or upload the downloaded CSV template. It requires exactly the delivery months in chronological order and columns `month,forward_usd_mmbtu,basis_usd_mmbtu`. Henry Hub must be positive; basis may be negative. Record source, valuation date and delivery location internally. Curve edits and notes persist by city and term for the current app session. They are not a saved customer database and disappear when the server session ends.

## Historical evidence and limitations

- Weather: [NOAA NCEI](https://www.ncei.noaa.gov/access/services/data/v1), monthly HDD65. Tulsa station USW00013968 uses complete years 2016–2021 and 2023–2025; all of 2022 is excluded because March carried a quality flag. Omaha USW00014942 and Columbus USW00014821 use 2016–2025. These selected histories are not the 1991–2020 climate normals or a prediction of next year.
- Historical Henry Hub spot: [EIA monthly series](https://www.eia.gov/dnav/ng/hist/rngwhhdm.htm), matched to weather by year/month. Spot history is not a forward quote.
- Demand: [public manufacturing energy-assessment database](https://itac.university/download). The reference is the rounded 6,104 MMBtu median of 14 positive-gas assessment records in the selected 2016–2025 manufacturing cohort, not a representative industry/Tulsa average. Five other matching records had blank gas values and were excluded. These are whole-facility records; repeat assessments may exist. The 60/40 seasonal split is an explicit scenario assumption.
- No actual customer bills, production records or financial statements are supplied. The app makes no regression-accuracy or R² claim. Other cities reuse the estimated annual gas benchmark with their own seasonal weather.

Bundled normalized data and quality notes are in `data/`. The app has no live feed or external transaction connection.

## Risk and credit

Monte Carlo resamples paired whole historical HDD/spot-price years, preserving within-year weather/price pairing. Monthly spot anomalies are centered on the entered Henry Hub curve; regional basis stays fixed. Two-year terms independently resample annual blocks. The 100,000 seeded draws reuse only nine Tulsa source years (ten in other cities), so they are a scenario exercise, not a calibrated future tail probability.

With customer deviations settled at the same monthly regional index and both price-component hedges matched to fixed blocks, the base-commodity contribution reconciles in every draw. Its P95 deterioration and component premium are structurally zero. The unhedged comparison illustrates commodity exposure. Daily/monthly mismatch, execution, fuel, financing and default remain outside this simulation. Full supplier risk is unpriced unless the user supplies separate allowances. P95 component premium equals P95 deterioration divided by contracted blocks; it is not a universal risk-pricing rule.

Credit formulas are current assets/current liabilities, interest-bearing debt/annual EBITDA, and annual EBIT/annual interest expense. Each earns 0–2 points:

| Ratio | 0 | 1 | 2 |
|---|---|---|---|
| Current ratio | <1 | 1 to <1.5 | ≥1.5 |
| Debt/EBITDA | >4 | >2 to 4 | ≤2 |
| EBIT/interest | <2 | 2 to <4 | ≥4 |

Only6/6 with no review flags passes the ratio screen under this conservative analyst-chosen rule. It still requires an approved unsecured limit and an exposure review. Other results require payment protection. Missing/invalid data, nonpositive denominators or negative EBITDA require review. Negative EBIT remains weak coverage; zero interest expense is not automatically strong coverage. The score is not a rating-agency model and determines neither a default premium nor a collateral amount.

## Privacy and files

The PDF uses controlled labels, dates and numeric fields. Internal names, arbitrary notes, corporate URLs and exact facility details are excluded from visible content and metadata. Anonymization does not guarantee that every possible combination of numeric assumptions is unidentifiable.

`app.py` provides the interface; `engine.py` pricing and risk; `credit.py` the ratio screen; `financials.py` the budget/cash/exposure calculations; `reports.py` both PDFs. `Estimated HVAC Gas Proposal.pdf` is the customer example and `Estimated HVAC Gas Internal Review.pdf` the internal example. The customer version excludes supplier margin, costs, hedges, risk results, financial ratios and exposure details. The default examples retain pending financials. `samples/tulsa-monthly-plan.csv` shows blocks and hedge legs. Power pricing, live trading and remote deployment are outside this natural-gas build.

Verification:

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -v
```

Tests cover financial formulas, missing/invalid inputs, price and hedge reconciliations, frozen contracts, city/term data boundaries, credit state and PDF anonymity. Browser and rendered PDF checks supplement the automated tests.

## Interface design

The local interface and PDF take visual inspiration from [Gladia](https://www.gladia.io/): a pale lavender hero, regular-weight typography, a dark rounded header and assumptions rail, pill navigation, and restrained purple accents. `ui.css` and `.streamlit/config.toml` provide the styling locally using system fonts. The six-step sequence uses local CSS motion, with keyboard navigation, reduced-motion support and narrow-screen layouts. The design refresh preserves the pricing, credit, risk and PDF workflows.
