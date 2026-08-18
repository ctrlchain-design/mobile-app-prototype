# mobile-app-prototype

Interactive design prototype for the CtrlChain (CCA) driver mobile app, built for **stakeholder review**.

## Status

Early stage — currently holds the exported design tokens (`colors.css`, `themes.css`) that back the prototype's styling. The reviewable prototype screens will be added on top of these.

## Deployment

This prototype is intended to be published for stakeholder review via **GitHub Pages** (a free `github.io` domain, no separate hosting needed). Once the prototype has reviewable screens, enable Pages under **Settings → Pages** on this repo (serve from `main` or a `gh-pages` branch) and share the resulting `https://ctrlchain-design.github.io/mobile-app-prototype/` link with stakeholders.

## Design tokens

- [`colors.css`](colors.css) — raw color primitives (neutrals, green, purple, orange, red, etc.)
- [`themes.css`](themes.css) — semantic light/dark theme variables built on top of `colors.css`

These CSS custom properties are for **this web-based stakeholder prototype only**.

## Production development

For actual app development (Flutter), color and design tokens are maintained separately in **[cca-olumoyeke/figma-flutter-sync](https://github.com/cca-olumoyeke/figma-flutter-sync)**. That repo is the Figma → Flutter sync contract — it mirrors the canonical `mobile-design-system/` tokens (Material 3 `ColorScheme`s, status/extended/component colors, state layers, type, shape, spacing, elevation) as ready-to-use Dart.

Use `figma-flutter-sync` as the source of truth when wiring up the real app; the CSS files here exist only to keep this prototype visually in sync with the same Figma source.
