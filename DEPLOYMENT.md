# Hosting the planner

## Current version

This repository contains the tested Python/Streamlit planner. It runs locally with Python 3.12 and the pinned requirements. The entrypoint is `app.py`. `Start.command` is only a local Mac launcher.

The current version is **not directly deployable on Netlify**. It needs a persistent Python server and WebSocket sessions. Netlify can use Python during a build, but this does not provide a running Streamlit server. A `netlify.toml` file alone cannot solve that difference.

References: [Streamlit architecture](https://docs.streamlit.io/develop/concepts/architecture/architecture), [Netlify Functions](https://docs.netlify.com/build/functions/overview/), [Netlify build dependencies](https://docs.netlify.com/build/configure-builds/manage-dependencies/).

## Netlify target

Netlify is the requested deployment target. A conversion is being discussed; it is not included in this version.

The proposed approach is a normal browser app that preserves the six steps, visual style, fixed-block contract logic, financial calculations, credit screen and two anonymous PDFs. Keep the Python implementation and its tests as the reference while validating the browser version against the same calculation cases. The conversion must prove pricing, cash timing, missing-input handling, saved-offer stress, credit exposure and PDF confidentiality before launch.

No financial features, accounts or customer database need to be added just to support a portfolio demonstration. A private GitHub repository does not make a publicly deployed website private.

## Before a public launch

- Finish and verify the chosen Netlify conversion; this branch is a working reference, not a Netlify build.
- Confirm redistribution rights or replace the bundled third-party market reference with a user-supplied curve. See [data notes](DATA_SOURCES.md).
- Keep estimated demand, source dates, omitted costs and Pending inputs visible.
- Use an anonymous demonstration case. Current software has no customer authentication or persistent customer database.
- Verify both PDFs and the six-step flow on the deployed URL.

The current Streamlit app processes inputs on its Python host. Its PDF generator excludes internal names and arbitrary source notes; that does not make the underlying host a private financial-data service. No live pricing API or runtime credentials are required.
