# Besrah implementation — contextual discovery, shopping evidence and unified saves (Phase 3–5 slice)

**Base:** main after PR #1 `2a29a42`. **No Production deployment.** Implementation merged into GitHub `main` as PR #2, commit `907b0c3`. Production release and private index rebuild are still outstanding.

## Implemented

1. **User intent on the home recommendation area:** `now / coffee / sweets / gift / essentials` chips map to café, confectionery, flowers and groceries. Explicit request beats time-based suggestions and profile preferences. Without an expressed need, clock-slot and explicit food preferences still apply. No inferred birthdays, events or sensitive behavior history; no automatic location request. API rejects unknown intents. Maximum two cards retained and their claims remain scoped to the available data.
2. **Safe shopping comparisons:** A resolved numeric price is not enough to establish identical variant or total payable cost. Offers with `variantUnresolved` or unsupported `matchState` are excluded from Core superlatives. Only `verified_variant` or `exact_sku`, with a positive safe integer price and fresh evidence, may compete. Core uses `listedItemPriceToman` instead of `totalCostToman`, and the UI label says only *lowest listed price in this set*, not cheapest final purchase or cheapest in market. Existing importer currently marks all source offers `listing_declared`, so **it is normal that real production listings show a range but no “lowest comparable variant” label** until verified variant evidence is available. No invented verification.
3. **Saved tab:** In addition to already-saved services, users see their **explicitly chosen** saved food vendors and products in the bottom-navigation Saved tab, with actionable re-search and individual deletion. Only local item ID/title/category are retained; no GPS, passive history or automatic orders. UI retains empty state when nothing saved.
4. **Weekly food plan (manual, device-local):** Explicitly choose a weekday (Saturday–Friday), meal slot (breakfast/lunch/snack/dinner), and suitable vertical (restaurant/fast food/café/sweets/bakery/grocery). One entry per weekday+meal slot, max 28. Each entry opens a real provider-category search through existing Besfood UI, applying the existing explicit user budget where set. Profile local-data deletion also clears it. This is **not** a calendar booking, food subscription, automatic ordering, delivery assurance or real inventory validation.
5. **Service hierarchy:** Third service is visibly **بسخرید (shopping)**. Existing stable internal `pay` route and stored service IDs are preserved to avoid breaking users; **بسپی** is correctly labelled as the future wallet/payment feature, not falsely declared functional. Besfood copy includes cafés, pastry, flowers, bakery and other marketplace categories.

## Automated checks

GitHub Actions `.github/workflows/ci.yml` checks Core typecheck/build/tests, Mini App JS tests and Python/Node integration suites. PR #2 head passed all three jobs (Core / Mini App / integrations), and the merged `main` must also pass before any release. Fixture-based evaluation is not end-to-end Production QA.

## Deployment gating

- Before publishing to Production: take snapshot of `/srv/besrah`, confirm live commit/manifest and current data hashes, ensure rollback.
- **Full-vendor food index:** PR #1 changed the importer to retain formerly excluded verticals, but no rebuilt index is in this public repository. Hermes must regenerate `data/food/food-index-v1.json.gz` from its *private* `research/vendors.sqlite` in a fresh staging directory, validate all source categories, links, counts, UTF-8, weights and unknown fields. Keep the old index and rollback independently.
- Confirm additive Core v1 metric values against any strict consumers. Existing production Core may lag GitHub `main`.
- Validate 320/360/390px and **real Android 10 Telegram**, especially new intent chips and Saved tab, nonrestaurant outbound links and snapshot/currency caveats. Also confirm no stale data is marked current. Monitor RAM under systemd 192MiB limit, Neshan call budget, disk >= current safety margin.
- Release must use a **new explicit owner authorization**, never old U7/U8/U10 tokens. Do not grant blanket SSH/production access to Cloud Session.
- User-provided data rights / provider usage policies must be checked before expanding or publishing raw catalogs.

## Still NOT implemented; require independent real data, provider access, owner consent or further development

- Live multi-vendor food prices, shipping ETA, menu availability and a real daily meal ordering/subscription service
- True interline transfer/entrance geometry, live vehicle arrivals, bus+metro+taxis optimal journeys, direct Snapp/Tapsi quotes, map picker without web key
- Multi-merchant fresh shopping feeds, verified SKU/variant identity, shipping+stock+BNPL, price alerts with a trustworthy price source
- Multi-provider account login, cross-channel saved items and explicit inferred preference learning (privacy/consent)
- Bespay wallet/transaction flows (regulatory and payment integration)
- Real end-user acceptance testing and a controlled rollout

The next phase should prioritize **source acquisition and partner/API connections**, plus a measurable real owner QA loop. Code alone cannot claim the remaining roadmap is finished.
