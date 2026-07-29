# Button Focus Interactions Design

## Goal

Remove the persistent colored or gray ring left on buttons after a mouse or
touch click while preserving clear keyboard focus and the existing color-only
hover and active feedback.

## Root Cause

The app combines the Vite starter rule for `button:focus` with PrimeVue Lara's
semantic button focus shadows. Mouse clicks leave the button focused, so those
styles remain visible after the action completes.

## Scope

Apply the interaction rule to every PrimeVue button rendered by `App.vue`:

- Compress all
- Clear all
- Download all
- Individual download buttons
- Individual remove buttons

Do not change compression behavior, button layout, colors, loading states,
disabled states, spacing, or responsive behavior.

## Interaction Contract

- Mouse and touch focus must have no outline or focus shadow.
- Keyboard focus through Tab must retain one subtle, consistent indigo ring.
- Hover and active feedback must remain color-only.
- Buttons must not translate, lift, or scale in any interaction state.
- Disabled buttons must keep their current behavior.

## Implementation

Add narrowly scoped PrimeVue button rules to the existing scoped style block in
`App.vue`:

- `:focus:not(:focus-visible)` removes both `outline` and `box-shadow`.
- `:focus-visible` removes PrimeVue's semantic shadow and supplies the single
  keyboard-only ring.

The selectors must be specific enough to override both the generic Vite button
focus rule and PrimeVue's success/danger focus shadows without changing buttons
outside this screen.

## Verification

- Confirm computed styles after clicking each main and per-image button.
- Confirm the ring does not persist after pointer activation.
- Navigate with Tab and confirm a visible keyboard focus ring remains.
- Confirm hover and active states only change color.
- Run the full test suite, production build, and `git diff HEAD --check`.
