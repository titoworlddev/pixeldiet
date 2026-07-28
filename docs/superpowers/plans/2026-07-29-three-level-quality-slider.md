# Three-Level Quality Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the continuous lossy-format quality range with the three user-facing levels Baja, Media, and Alta.

**Architecture:** Keep numeric encoder quality as the source passed to existing compression and cache code. Add a small shared level policy and bind the active native range input to level indices 0-2.

**Tech Stack:** Vue 3 Composition API, native HTML range input, Vitest, Vite.

## Global Constraints

- Map `Baja`, `Media`, and `Alta` to 35, 50, and 75 respectively.
- Never show percentages in the interface.
- Keep `Alta` as the default.
- Keep the quality control hidden for PNG and disabled during processing.
- Do not change encoder implementations or add dependencies.
- Do not commit or stage changes.

---

### Task 1: Add And Render Discrete Quality Levels

**Files:**
- Modify: `src/utils/compressionProfile.js`
- Modify: `src/utils/compressionProfile.test.js`
- Modify: `src/App.vue`

**Interfaces:**
- Produces: `COMPRESSION_QUALITY_LEVELS`, an ordered array of `{ label, value }` entries.
- Consumes: the existing numeric `compressionQuality` state and unchanged encoder API.

- [ ] **Step 1: Write the failing policy test**

Assert that the exported levels equal:

```js
[
  { label: 'Baja', value: 35 },
  { label: 'Media', value: 50 },
  { label: 'Alta', value: 75 }
]
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/utils/compressionProfile.test.js`

Expected: failure because `COMPRESSION_QUALITY_LEVELS` is not exported.

- [ ] **Step 3: Add the level policy and slider binding**

Export the ordered levels from `compressionProfile.js`. In `App.vue`, derive a writable computed index from the current numeric quality, set the input to `min="0"`, `max="2"`, `step="1"`, replace percentage copy with level copy, render all three labels, and expose the current label through `aria-valuetext`.

- [ ] **Step 4: Run focused and full verification**

Run `npm test -- src/utils/compressionProfile.test.js`, then `npm test`, then `npm run build`.

Expected: all tests and build pass.

- [ ] **Step 5: Verify in the browser**

Confirm WebP/JPEG show three keyboard-selectable stops with no percentages, PNG hides the control, the default is Alta/75, and the layout remains usable on desktop and mobile.
