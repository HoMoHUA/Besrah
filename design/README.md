# Design system source

`hm7-commerce/` is the owner-supplied HM7 Commerce design system (Persian RTL, light/dark tokens, glass materials, motion engine) used as the visual and interaction basis for the Besrah Mini App. It holds the written book (`README.md`, `01`–`11` chapters), `tokens.json` and one README/preview per component.

Runtime files (tokens, bundle, fonts) are vendored unmodified in `apps/miniapp/vendor/hm7/`. Besrah-specific colour and font changes live only in a separate skin file loaded after `tokens.css`, as the design system prescribes. Do not edit vendored files; regenerate them from a new export instead.

The other exported systems (`hm7-panel`, `hm7-player`, `homogram`) are intentionally not part of this repository.

Fonts and the icon font are licensed by their owners to the design-system owner; confirm that public web redistribution is covered before opening this repository or the Mini App beyond the private deployment.
