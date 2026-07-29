# Default Dark Theme Design

## Objective

Make PixelDiet a forced dark-theme application with no theme selector. Preserve
the existing layout, typography, spacing, behavior, indigo/blue brand colors,
and semantic status colors while converting every active surface and control to
a technical, sober dark system.

## Tech Stack

- Vue 3.3 single-page application
- PrimeVue 3.46 with the Lara dark indigo theme
- Tailwind CSS 3.3 utilities
- Scoped CSS and semantic custom properties
- Vitest 3.2 and Vite 5

## Commands

- Development: `npm run dev -- --host 127.0.0.1`
- Focused tests: `npm test -- src/App.test.js src/theme.test.js`
- Full tests: `npm test`
- Production build: `npm run build`
- Diff validation: `git diff HEAD --check`

## Project Structure

- `src/main.js`: selects the forced PrimeVue dark theme.
- `src/assets/css/global.css`: owns semantic dark-theme color tokens.
- `src/style.css`: applies the dark canvas, global text, PrimeVue button, and
  toast defaults.
- `src/App.vue`: applies semantic surfaces and states to the active interface,
  including upload, format controls, slider, image rows, and footer.
- `src/App.test.js`: protects the forced dark-theme contract and current
  responsive structure.

Legacy components not mounted by `App.vue` are outside this change.

## Code Style

Use named semantic tokens instead of scattering dark literals through the
template:

```css
:root {
  --app-canvas: #090d17;
  --app-surface: #111827;
  --app-surface-raised: #1f2937;
  --app-border: #334155;
  --app-text: #f8fafc;
  --app-text-secondary: #cbd5e1;
  --app-text-muted: #94a3b8;
}
```

Component classes consume these tokens. Brand and semantic states retain named
tokens for indigo, blue, green, amber, and red. Do not add gradients, colored
glows, glass effects, or theme-switching state.

## Visual System

- Canvas: `#090d17`
- Primary panel: `#111827`
- Raised/inset control: `#1f2937`
- Hover surface: `#273449`
- Border: `#334155` at one pixel
- Primary text: `#f8fafc`
- Secondary text: `#cbd5e1`
- Muted text: `#94a3b8`
- Brand indigo: `#4f46e5`
- Brand blue: `#3b82f6`
- Existing success, warning, and error hues remain semantic-only

Depth comes from small surface-lightness steps and quiet borders, not dark-mode
drop shadows. Inputs and inactive format buttons read as inset surfaces. The
active format remains a solid indigo fill.

## Interaction States

- Upload drag state uses a translucent blue surface and blue border without a
  light background.
- Inactive formats use dark slate, light text, and a subtle border; hover raises
  the surface one step; active selection remains indigo.
- Slider track, marks, thumb border, and focus ring must all remain visible on
  dark panels.
- Image list rows use the panel surface with quiet separators and a raised hover
  surface; filenames and metadata use the established text hierarchy.
- Pointer focus keeps no persistent ring; keyboard focus retains the existing
  accessible indigo ring.
- Disabled, loading, success, warning, error, badges, toasts, and tooltips must
  remain readable and must not rely on color alone.

## Testing Strategy

- A source-level regression checks the static PrimeVue theme import and exact
  tokens; SSR assertions check semantic classes and accessible controls.
- Existing behavior tests must pass unchanged.
- Real Chrome verification covers empty, pending, and compressed states at 320,
  768, 1024, and 1440 pixels.
- Browser checks include horizontal overflow, readable text, panel hierarchy,
  hover/focus states, slider visibility, list separators, toasts, and console
  errors.
- Production build and diff whitespace checks remain mandatory.

## Boundaries

- Always: force dark mode, preserve behavior and layout, retain keyboard focus,
  verify contrast and all responsive breakpoints.
- Ask first: change typography, layout, copy, radii, dependencies, or brand
  colors beyond contrast variants.
- Never: add a theme toggle, follow system color preference, add a light-mode
  branch, introduce gradients/glows, modify codec behavior, or edit unmounted
  legacy components.
- Do not commit or stage changes without explicit user instruction.

## Success Criteria

- The page canvas is dark on first load regardless of system preference.
- Upload, settings, inactive formats, slider, image-list container, and image
  rows contain no white or light-gray surfaces.
- PrimeVue controls, badges, toasts, tooltips, and progress elements use the dark
  theme without light-theme remnants.
- Primary, secondary, muted, status, and focus text remain readable.
- The approved column/grid responsive behavior is unchanged.
- No horizontal overflow appears from 320 through 1440 pixels.
- Full tests, production build, and diff checks pass.

## Open Questions

None. Palette, technical/sober tone, forced default behavior, and semantic-token
implementation were approved by the user.
