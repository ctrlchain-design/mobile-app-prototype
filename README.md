# mobile-app-prototype

Interactive design prototype for the CtrlChain (CCA) driver mobile app, built for **stakeholder review**.

## Status

**Phase 1 (live):** New Driver onboarding — both entry paths from the CCA Driver App FigJam flow are built and clickable:
- **Self-Registration** — phone/email/social signup, OTP, name entry, GDPR, pending-approval state, locked/unlocked dashboard.
- **Portal-Based (Magic Link)** — simulated SMS invite, install prompt, code entry, pre-filled confirm-details, OTP, optional PIN setup, GDPR, dashboard.

Use the "Prototype controls" bar at the top of the page to jump between the two flows at any point, or restart the current one. All data is mocked — nothing here talks to a real backend.

Not yet built: Returning Driver, Guest/One-Off Driver, and everything past onboarding (dashboard trips, milestone confirmation, exceptions, communication) — see the FigJam board for that scope.

## Deployment

Published for stakeholder review via **GitHub Pages** (free `github.io` domain, no separate hosting needed): **https://ctrlchain-design.github.io/mobile-app-prototype/**

Pages builds automatically from the `main` branch root on every push to `main` — no CI config needed, just push.

## Stack

Vanilla HTML/CSS/JS, no build step, no dependencies (`index.html`, `styles.css`, `app.js`). Hash-routed single-page app — each screen is a route (e.g. `#self-reg-otp`), so browser back/forward works naturally. All screens and mocked state live in `app.js`.

## Design tokens

- [`colors.css`](colors.css) — raw color primitives (neutrals, green, purple, orange, red, etc.)
- [`themes.css`](themes.css) — semantic light/dark theme variables built on top of `colors.css`

These CSS custom properties are for **this web-based stakeholder prototype only**.

## Production development

For actual app development (Flutter), color and design tokens are maintained separately in **[cca-olumoyeke/figma-flutter-sync](https://github.com/cca-olumoyeke/figma-flutter-sync)**. That repo is the Figma → Flutter sync contract — it mirrors the canonical `mobile-design-system/` tokens (Material 3 `ColorScheme`s, status/extended/component colors, state layers, type, shape, spacing, elevation) as ready-to-use Dart.

Use `figma-flutter-sync` as the source of truth when wiring up the real app; the CSS files here exist only to keep this prototype visually in sync with the same Figma source.
