# Button Focus Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove persistent pointer focus rings from all PrimeVue buttons in `App.vue` while preserving one subtle keyboard-only focus indicator.

**Architecture:** Keep the fix local to the existing `App.vue` scoped style block. Override PrimeVue and Vite focus output by input modality with `:focus:not(:focus-visible)` and `:focus-visible`; do not alter component logic or introduce JavaScript focus management.

**Tech Stack:** Vue 3.3, PrimeVue 3.46, scoped CSS, Vitest 3, Vite 5, Chrome DevTools.

## Global Constraints

- Mouse and touch focus must have no outline or focus shadow.
- Keyboard focus through Tab must retain one subtle, consistent indigo ring.
- Hover and active feedback must remain color-only.
- Buttons must not translate, lift, or scale in any interaction state.
- Do not change compression, download, upload, loading, disabled, responsive, or layout behavior.
- Add no dependency.
- Do not commit or stage changes without an explicit user request.

---

### Task 1: Normalize PrimeVue Button Focus by Input Modality

**Files:**
- Modify: `src/App.vue:818-822`
- Verify: `src/App.test.js`
- Reference: `docs/superpowers/specs/2026-07-29-button-focus-interactions-design.md`

**Interfaces:**
- Consumes: PrimeVue's `.p-button` classes and browser `:focus-visible` input-modality behavior.
- Produces: A scoped CSS contract for pointer and keyboard focus; no JavaScript API changes.

- [ ] **Step 1: Reproduce the pointer-focus failure in Chrome**

Load the app, render a main action button and an image-row action button, click each with the pointer, and inspect:

```javascript
const button = document.activeElement;
const styles = getComputedStyle(button);
({ outline: styles.outline, boxShadow: styles.boxShadow });
```

Expected before the fix: at least one clicked button reports a non-`none` outline or box shadow, and the ring remains visible while the button retains focus.

- [ ] **Step 2: Add the minimal scoped CSS override**

Add below the existing `:deep(.p-button)` rule in `src/App.vue`:

```css
:deep(.p-button:focus:not(:focus-visible)) {
  outline: none !important;
  box-shadow: none !important;
}

:deep(.p-button:focus-visible) {
  outline: 2px solid #4f46e5 !important;
  outline-offset: 2px;
  box-shadow: none !important;
}
```

Do not add transforms, transitions, blur handlers, or per-button classes.

- [ ] **Step 3: Verify pointer and keyboard behavior in Chrome**

For compress, clear, download-all, individual download, and individual remove buttons:

```javascript
const button = document.activeElement;
const styles = getComputedStyle(button);
({ outline: styles.outline, boxShadow: styles.boxShadow });
```

Expected after pointer activation: `outline` has zero width or `none`, and `boxShadow` is `none`.

Navigate to the same controls using Tab. Expected: a `2px` indigo outline with `2px` offset and no box shadow. Hover and active states change color without any non-`none` transform.

- [ ] **Step 4: Run automated regressions**

Run:

```bash
npm test
npm run build
git diff HEAD --check
```

Expected: 216 tests pass, the production build exits 0, and the diff check prints no errors. The CSS-only change must not alter existing rendered-control tests.

- [ ] **Step 5: Review the final diff without committing**

Run:

```bash
git diff HEAD -- src/App.vue docs/superpowers/specs/2026-07-29-button-focus-interactions-design.md docs/superpowers/plans/2026-07-29-button-focus-interactions.md
git status --short
```

Expected: only the approved focus interaction and its documentation are newly added by this task; existing AVIF/JXL work remains untouched. Do not stage or commit.
