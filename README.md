# West Gas Planner

Fuel buy planner and shareable report creator. Static site: no build step, no server, no API key.

**Status:** prototype, live at https://westgasplanner.netlify.app. Unofficial: not a Cenovus Energy product, and the demo data is **not Cenovus data**.

## Open it

Double-click `public/index.html`. Everything loads from local files (`data.js` carries the data, so there is no `fetch`). Only the IBM Plex Sans font comes from Google Fonts; offline it falls back to the system font.

Or serve `public/`: `python3 -m http.server 8000 -d public`, then open http://localhost:8000.

## What it does

| View | Purpose |
| --- | --- |
| Overview | Order-to-invoice score gauge, five-band order check, KPI cards, monthly gallons with implied $/gal, orders to follow up |
| Planner | Forecast gallons and spend from the month after the last record to the contract term end. Baseline (last 3 / last 6 / all months), volume adjustment, price source and shock, tax-and-other uplift, monthly budget cap, Base / Lean / Stress presets |
| Orders | Search, filter, sort and page all orders; click one for PO lines, invoices and source links |
| Report creator | Pick sections, range, title and a summary note. Live preview. Downloads **one self-contained HTML file** (no scripts, no network). "Print / save PDF" uses the browser print dialog |
| Sources & limits | Contract context, definitions, data files |

Planner settings and report options are remembered in the browser (`localStorage`).

## Use your own data

Settings (top right) → Load data, then pick a JSON file shaped like `data.json`:

- `orders[]`: `po_id`, `listed_date` (YYYY-MM-DD), `mode`, `ordered_gallons`, `po_fuel_amount`, `po_tax_amount`, `po_other_amount`, `po_total`, `invoice_total` (null if none), `difference`, `difference_class` (`exact_match` | `minor_adjustment` | `invoice_not_in_loaded_file`), `review_reasons[]`, `po_lines[]`, `invoices[]`, `source_files[]`
- `monthly[]`: `month` (YYYY-MM), `orders_count`, `ordered_gallons`, `po_fuel_amount`, `po_total`, `invoice_total`, `review_count`
- `summary`, `contract` (incl. `term_end`, `estimated_annual_gallons`), `methodology`, `sources[]`, `as_of`

Loaded data stays in the browser. To make a new file the default, regenerate `data.js`:

```bash
python3 -c "print('window.__PLANNER_DATA__ = ' + open('public/data.json').read() + ';')" > public/data.js
```

`src/build_data.py` in the `cmh_diesel_monitor` repo produces this schema from City of Columbus open data.

## How the forecast works

Monthly gallons = baseline x (1 + volume adjustment). Baseline is the mean of the chosen recorded months. Diesel $ = gallons x price x (1 + shock). Full PO $ = diesel $ x (1 + uplift), where uplift defaults to what the data shows (full PO total over diesel line amount). Whisker = plus or minus N standard deviations of recorded monthly gallons. Orders = gallons / average order size.

Known limits: one partial year, so **no seasonality**; gallons are order quantities, not deliveries; price is implied from PO lines, not a contract index; the 600,000 gal/yr bid estimate covers several fuel types.

## Tests

```bash
node tests/model.test.js
```

## Folder map

- `public/`: the deployed app (`index.html`, `styles.css`, `app.js`, `charts.js`, `model.js`, `report.js`, `data.js`, `data.json`)
- `tests/model.test.js`: forecast model checks
- `docs/genesis-recon.md`: what was studied on genesis.live and how it maps here
- `netlify.toml`: publishes `public/`, no build step

Before wider use: decide the real data source, replace the demo data, and review the name and branding with Cenovus.
