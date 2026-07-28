# Three-Level Quality Slider Design

## Goal

Replace the continuous quality control for lossy formats with three discrete,
user-facing levels while keeping the compression APIs unchanged.

## Behavior

- The slider has exactly three positions: `Baja`, `Media`, and `Alta`.
- The positions map internally to quality values 35, 50, and 75.
- `Alta` remains the default.
- Percentages are not shown in the interface.
- PNG continues to hide the quality control.
- The control remains disabled while a batch is processing.

## Implementation

The active native range input in `App.vue` uses indices 0, 1, and 2. A small
quality-level policy maps those indices to the existing numeric quality values,
so the encoder calls, cache keys, and batch snapshot continue receiving numbers
without algorithm changes.

The track keeps the existing visual language and displays the three text labels
under their corresponding positions. The range exposes the selected text level
through `aria-valuetext` for keyboard and screen-reader users.

## Verification

- Unit tests cover the three index-to-quality mappings.
- Browser checks cover mouse and keyboard selection, labels, PNG visibility,
  disabled processing behavior, and desktop/mobile layout.
- The full test suite and production build must pass.
