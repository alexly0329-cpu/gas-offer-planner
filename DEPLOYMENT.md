# Netlify deployment

The browser planner is served from `public/`. It preserves the six guided steps, estimated financial logic, charts and two anonymous PDFs. Entries and PDF generation stay on the visitor's device. No Python server, customer database, analytics library or external pricing API is needed.

## Settings

The root `netlify.toml` sets build command `node scripts/check-web.mjs`, publish directory `public`, and Node.js24. Keep the repository base at its root. File-based settings override matching Netlify UI settings. Pushing `main` triggers the existing connected production deployment. Do not publish the repository root: the Python files are calculation references, not browser entrypoints.

## Local preview and checks

```sh
node --test web-tests/*.test.mjs
node scripts/check-web.mjs
python3 -m http.server 8503 --directory public
```

Open `http://localhost:8503`. Opening index.html directly as a local file is not supported because modules and reference-data loading need a web server. The original Streamlit app remains available using Start.command or README.md instructions.

To regenerate normalized data and exact fixed-seed scenario weights after changing the Python reference/data, use the pinned Python environment:

```sh
python scripts/export-browser-data.py
python scripts/export-browser-data.py --check
```

The browser computes results for weighted counts of the same100,000seeded paired-year draws. It does not download a Python runtime or replace them with a different random sample. The PDF library and license are served locally.

## Data and scope

Confirm data-use permissions and refresh the market curve before a commercial quote. Regional basis remains a delivery-route proxy with a corroborated date; actual route matching needs confirmation. Customer demand remains estimated until monthly bills and matched weather validate it. See DATA_SOURCES.md.

This is a planning demonstration, not a firm quote, data vault or trading system. Simplified operating funding excludes daily hedge collateral and unsupported default-loss pricing. A private source repository does not make a public website private.

References: [Netlify configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/), [original Streamlit architecture](https://docs.streamlit.io/develop/concepts/architecture/architecture).
