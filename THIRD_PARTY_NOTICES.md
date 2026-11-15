# Browser dependencies

The Netlify browser app includes jsPDF 4.2.1, distributed under the MIT license. Its license is included at `public/vendor/jspdf-LICENSE.txt`.

The browser bundle was obtained from the official `jspdf` npm package, tarball `https://registry.npmjs.org/jspdf/-/jspdf-4.2.1.tgz`.

Published package integrity: `sha512-YyAXyvnmjTbR4bHQRLzex3CuINCDlQnBqoSYyjJwTP2x9jDLuKDzy7aKUl0hgx3uhcl7xzg32agn5vlie6HIlQ==`.

jsPDF is served as a local asset. No analytics or external chart libraries are loaded. Third-party data is described separately in DATA_SOURCES.md; the software license does not grant data redistribution rights.

## Map and typography

The landing page loads satellite imagery from [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer). Attribution is displayed on the map: Esri, Maxar, Earthstar Geographics, and the GIS User Community. Service availability and terms apply; imagery is not redistributed in this source package.

State geometry in `public/data/states.json` is derived from [PublicaMundi MappingAPI U.S. states GeoJSON](https://github.com/PublicaMundi/MappingAPI/blob/master/data/geojson/us-states.json). Only state names and geometries are retained. It is for geographic illustration, not authoritative legal boundaries or service territories.

DM Sans and IBM Plex Mono are loaded through Google Fonts with system-font fallbacks. See [DM Sans](https://github.com/googlefonts/dm-fonts) and [IBM Plex](https://github.com/IBM/plex) for their font licenses. These external requests contain no planner inputs.
