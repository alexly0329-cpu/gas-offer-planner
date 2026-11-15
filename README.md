# GAS / LOCAL — West Gas Planner

A local website connecting the approved U.S. map landing page to the full West Gas Planner dashboard. Nothing has been pushed or deployed.

## Open the website

Run this from the extracted project folder:

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory public
```

Open http://127.0.0.1:8767 in your browser. On macOS, `Start.command` runs the same server. Python 3 is required only to serve the files locally; the website itself is static. Do not open `public/index.html` directly because its modules and data need a local server.

## What is included

- U.S. landing map with Oklahoma/Tulsa, Nebraska/Omaha and Ohio/Columbus focus views using real state outlines.
- Smooth, keyboard-aware navigation into the restored Overview, six-step Build offer and Offer book dashboard.
- Shared city selection, larger type, and a top-right light/dark switch. Reduced-motion preferences are respected.
- Original calculations, credit screen, monthly volume and price charts, saved-offer stress testing, CSV exports and anonymous customer/internal PDFs.
- Original Python reference, normalized source data and research documentation.

Inputs and saved offers remain intact when moving between the map and dashboard during one page session. Refreshing or closing the page resets them. Export PDFs/CSVs before leaving. The three initial offer-book entries are illustrative examples.

## Numbers and research boundaries

The estimated annual baseline is 6,100 MMBtu with an assumed 40% weather-sensitive share. The default +20% heating-degree-day scenario therefore gives 6,588 MMBtu (6,100 × [1 + 0.40 × 0.20]). This is a commercial operating-profile example, not a regional household average or utility bill forecast.

Tulsa has an archived monthly price reference. Missing Omaha/Columbus prices and missing supplier costs remain pending, not zero. Partial subtotals are not firm quotes. State outlines indicate geography, not utility service territories. See [DATA_SOURCES.md](DATA_SOURCES.md) for provenance and data-use restrictions, and [RESEARCH.md](RESEARCH.md) for the original research and calculation documentation.

Calculations, entered customer labels and PDF creation stay on your device. The site requests satellite imagery from Esri and fonts from Google Fonts; it does not send planner inputs to those services. If imagery fails, the local state outlines and planner remain usable. Fonts have local fallbacks.

## Check the website

With Node.js installed:

```sh
node --test web-tests/*.test.mjs
node scripts/check-web.mjs
```

The browser model and reporting checks cover the inherited calculation logic, pending values, frozen offers, CSV handling and PDF privacy. Additional checks cover state geometry and nonblocking map initialization.

## Source history

Planner logic is based on `alexly0329-cpu/gas-offer-planner` commit `5ef901bdc974d4ec3f616f6861c18063dd721b2e`. The dashboard shell restores the Overview/sidebar structure from commit `143d626f0f457c9b8a1ce6f00c8e9f8b19f0ef7a`, with the approved map design and shared theme integrated locally.

The browser entrypoint is `public/`. No build tool or new package dependency is needed. `Start-Python.command` retains the original Streamlit launcher. Before publishing, review [DEPLOYMENT.md](DEPLOYMENT.md) and the source-data permissions. This folder is ready for your own repository; no GitHub action has been taken.
