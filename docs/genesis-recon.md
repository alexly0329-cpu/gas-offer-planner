# Genesis dashboard recon (genesis.live, studied Nov 9 2026)

Source: https://www.genesis.live/#sky. Genesis Soil Intelligence; Framer-built marketing site (`framerusercontent.com` bundle, ~894 KB HTML, no auth). The product dashboard is shown as an image/mock on the "The platform" section, so layout was reconstructed from screenshots, not copied code.

## Dashboard anatomy observed

- Left sidebar: logo, Home, Crops, Production modes, Farms, Compare; Administration / Documentation / Collapse at the bottom.
- Dark green entity banner: logo tile, name, chips (country, crop, confidence), Settings and Export buttons.
- Tab row under the banner (Resilience / Impact / Practices) and a "Latest ratings" selector.
- Info line about the data window.
- Card 1: "Resilience score", a 0-10 semicircle gauge with a 5-band scale and "GOOD" label.
- Card 2: "Proportion of healthy soils": big percentage left, five coloured columns right (Critical 0-2 red, Degraded 2-4 orange, Fair 4-6 yellow, Good 6-8 green, Optimal 8-10 teal), count above each bar.
- Card 3: ranked table ("Soil health by provenance") with rating chips beside a map.
- Marketing cards: horizontal meters (water, biodiversity, carbon), "identify hotspots", before/after comparison, "+1.5 pts" progress stat.
- Style: rounded 16-20 px cards, soft sky gradient, IBM Plex Sans-like type, pill buttons.

## Mapping to West Gas Planner

| Genesis | Here |
| --- | --- |
| Entity banner + chips + Settings/Export | Banner with vendor, product, agreement, snapshot chips; Settings loads data, Export opens Report creator |
| Resilience gauge (0-10) | Order-to-invoice score = matched / orders x 10 |
| Proportion of healthy soils, 5 bands | Orders by invoice check, 5 bands (>= $25 gap, no invoice, $1-25, within $1, exact), plus an Order size view |
| Horizontal meters | KPI card meters |
| Table + rating chips | Orders table with check pills and detail dialog |
| "+1.5 pts since 2021" progress | Planner: forecast vs bid-estimate share |

Not reproduced: Genesis logo, imagery, copy, photography, or client logos. Palette is a neutral red / charcoal energy palette; no Cenovus logo or name appears in the product.
