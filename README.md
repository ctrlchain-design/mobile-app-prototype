# mobile-app-prototype

Interactive design prototype for the CtrlChain (CCA) driver mobile app, built for **stakeholder review**.

## Status

Early stage — currently holds the exported design tokens (`colors.css`, `themes.css`) that back the prototype's styling. The reviewable prototype screens will be added on top of these.

## Deployment

Published for stakeholder review via **GitHub Pages** (free `github.io` domain, no separate hosting needed): **https://ctrlchain-design.github.io/mobile-app-prototype/**

Pages builds automatically from the `main` branch root on every push. Since there's no `index.html` yet (see [Status](#status)), the live URL won't show a prototype screen until one is added — pushing an `index.html` to `main` is enough to make it appear.

## Design tokens

- [`colors.css`](colors.css) — raw color primitives (neutrals, green, purple, orange, red, etc.)
- [`themes.css`](themes.css) — semantic light/dark theme variables built on top of `colors.css`

These CSS custom properties are for **this web-based stakeholder prototype only**.

## Production development

For actual app development (Flutter), color and design tokens are maintained separately in **[cca-olumoyeke/figma-flutter-sync](https://github.com/cca-olumoyeke/figma-flutter-sync)**. That repo is the Figma → Flutter sync contract — it mirrors the canonical `mobile-design-system/` tokens (Material 3 `ColorScheme`s, status/extended/component colors, state layers, type, shape, spacing, elevation) as ready-to-use Dart.

Use `figma-flutter-sync` as the source of truth when wiring up the real app; the CSS files here exist only to keep this prototype visually in sync with the same Figma source.
