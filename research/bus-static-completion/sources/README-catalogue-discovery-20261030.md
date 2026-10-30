# Static catalogue discovery — 2026-10-30

## Result

**No current, operator-published complete denominator or downloadable route/stop/geometry feed was obtained.** A dated primary-publisher aggregate was recovered: IRNA reports **175 active lines** in its article published **2026-07-30**, verified in the original article through an ordinary browser on 2026-10-30. This is not an operator-signed census: it supplies no reference list, mode/branch/suburban counting definition, dataset revision or October validity. Do not calculate OSM coverage against it.[10]

The most useful municipal catalogue lead is `farhangi.mashhad.ir`, page **902102**, titled as an urban-bus line list in search discovery. Its content and date could not be retrieved. Direct and existing-proxy HTTPS requests connected but timed out before TLS completion; HTTP also timed out.[3]

The municipal map and bus pages did not provide retrievable catalogue content.[1][2]

Neither did the statistics and planning pages in these bounded requests.[4][5]

These observed transport failures do **not** establish GeoIP filtering, permanent outage, or absence of a public dataset.

## Concrete reconciliation leads

An original Shahra Ara field report published **2026-09-09** describes former **830** as split/replaced by **831, 832 and 833**. An unnamed line supervisor gives endpoint descriptions: **831: Mosalla–Elahiyeh; 832: Shirazi shrine overpass–Elahiyeh; 833: Shahid Beskabadi–Ferdowsi**. The 833 starting terminal is inferred from the immediate narrative location, explicitly flagged in JSON. These are news-supported manual-review candidates, **not an official route inventory or current-service certification**; no stop order or geometry was obtained.[6]

A read-only SQLite comparison found two exact `831` route relations with the Mosalla/Elahiyeh endpoint pair, and no exact `830`, `832` or `833` line reference. Literal OSM IDs and endpoint fields are preserved in `catalogue-facts-20261030.json`. No source identifiers were normalized or merged, and nothing was imported.

## Rejected denominator shortcuts

- **107** refers to a special-event operation in July 2026, not a complete current network census.[7]
- **1740** in an October 2026 report counts active vehicles, not lines or stations.[9]
- The **1403 yearbook** article concerns preparation of that publication; it provides neither a bus census nor an inspected download.[8]
- Parent follow-up downloaded the third-party PDF under the 2025 upload path: it differs from the saved 2019 guide, has 19 pages and a 2024-10-14 file-creation timestamp. The operator-branded cover shows no network-validity date. Numeric reference mentions were extracted separately as research-only, not promoted; see `../additional-pdf-check.json` and `../book2024-reference-mentions.json`.

## Evidence and safeguards

- `catalogue-facts-20261030.json`: bounded source records, publication dates, short verified quotes, accepted/rejected interpretations and exact read-only OSM comparison.
- `catalogue-probes-20261030.json`: request times, status/errors, TLS-stage timings where captured, byte counts and SHA-256; DOM-capture hashes are explicitly distinguished from raw HTML hashes.
- `catalogue-search-log-20261030.json`: queries, retrieval timing precision, backend limitations and hashes/paths of local-only raw search batches. Many fallback results were off-topic and rejected; failed discovery is not proof of nonexistence.
- `catalogue-citations-20261030.json`: mechanically assigned source IDs and quote evidence.

Full article/search captures remain only under `/root/.hermes/cache/scratch/besrah-static-sources-20261030/`, not in this research deliverable. Retained quotations are at most 25 words per source. No ETA endpoints, APKs, credentials, authentication bypass, proxy changes, production actions or commits were performed. Existing code, database and app files were not modified.

## Sources

[1] https://map.mashhad.ir/fa
[2] https://bus.mashhad.ir
[3] https://farhangi.mashhad.ir/fa/general_content/902102-لیست-خطوط-اتوبوس-شهری.html
[4] https://amar.mashhad.ir
[5] https://planning.mashhad.ir
[6] https://shahraranews.ir/fa/news/443868
[7] https://shahraranews.ir/fa/news/428287
[8] https://shahraranews.ir/fa/news/348677
[9] https://shahraranews.ir/fa/news/450834
[10] https://irna.ir/news/86223472
