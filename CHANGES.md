# West Gas Planner: theme and type update

Copy the four files in `public/` over the same files in the repo's `public/` folder (`theme.js` is new). Nothing is committed or pushed. `changes.patch` holds the same edits as a diff. `mockup/` holds the screenshots.

## Changes
- Light/dark toggle pinned to the top-right corner, remembered across visits, applied before first paint.
- Text larger: base 17px, nothing under 14px, chart labels 13-14px.
- Charts follow the theme (they were unreadable in dark mode).
- Reference-style hero: monospace labels, city coordinates, stat strip, headline moved right so it no longer covers the Tulsa pin.
- Stat strip labels the $3.0171 as a partial subtotal (supplier costs pending).

## Numbers checked (Tulsa, 12 months, +20% HDD)
6,588 MMBtu; Henry Hub $3.0861; basis -$0.2690; $2.8171 before margin; $3.0171 with $0.20 margin; margin 6.6% of price; target contribution $1,317.60; fixed-block subtotal $19,876.64 (app and README agree). All 60 repo tests pass.

## Not checked
Build offer, Offer book and PDFs in dark mode; phone widths (chart text shrinks). README has missing spaces ("6,100MMBtu", "January2027"). Earlier research documents were not available.
