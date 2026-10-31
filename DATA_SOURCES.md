# Data and release notes

The repository contains an estimated operating profile and normalized historical reference data, not actual customer statements or meter records.

| File | Source and scope |
| --- | --- |
| `data/weather_history.csv` | NOAA NCEI monthly HDD65 for the selected stations/years; exclusions and reference totals are in `data/provenance.json`. [NOAA service](https://www.ncei.noaa.gov/access/services/data/v1) |
| `data/hh_spot_history.csv` | EIA monthly Henry Hub spot history, paired with the weather cohort. It is not a forward curve. [EIA series](https://www.eia.gov/dnav/ng/hist/rngwhhdm.htm) |
| `data/market_curves.csv` | Archived Tulsa 2027 settlement/basis reference. Valuation date and indirect basis-date corroboration are described in `data/provenance.json`. Actual delivery-route matching remains unconfirmed. |
| Estimated demand | The rounded median of 14 positive-gas records in a selected public assessment cohort, with an assumed 60/40 steady/heating split. It is not a representative regional average or a calibrated customer forecast. [Assessment database](https://itac.university/download) |

The market reference is an indicative archived case, not a live executable quote. It has no recorded permission for public redistribution in this project. Before including it in a public site or public repository, verify the applicable provider terms or replace it with a properly licensed/user-supplied curve. The same review applies to derived market-price examples and PDFs.

No blanket open-source license is granted over third-party data by this repository. Private source backup and permission to redistribute market data publicly are separate decisions.
