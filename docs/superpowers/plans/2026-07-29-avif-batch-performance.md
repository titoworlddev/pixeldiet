# AVIF And Batch Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Reduce AVIF encoding time and process image batches with safe bounded concurrency.

**Architecture:** AVIF uses the measured speed-6 profile. The modern worker client becomes a two-slot, load-balanced pool, while a small batch policy controls per-format concurrency and commits results to Vue state only after all work settles.

**Tech Stack:** Vue 3, Vitest, Vite module workers, jSquash WASM.

## Global Constraints

- AVIF speed is exactly 6; all other codec options remain unchanged.
- Modern worker pool maximum is 2; fewer than 4 logical processors or unknown hardware use 1.
- Modern batch concurrency equals pool capacity; native lossy concurrency is 4; PNG concurrency is 1.
- Apply all card results together after the batch completes.
- Preserve cache skipping, snapshotted settings, generic errors, and aggregate notifications.
- Do not change output bytes contracts, signatures, MIME/extensions, previews, 20 MP cap, or PNG/JPEG/WebP algorithms.
- Do not commit, stage, reset, revert, push, or clean.

---

### Task 1: Adopt The Measured AVIF Speed Profile

**Files:**
- Modify: `src/utils/modernImageCompression.js`
- Modify: `src/utils/modernImageCompression.test.js`

- [ ] Add a failing option-contract test requiring AVIF `speed: 6`.
- [ ] Run the focused suite and verify the current speed-4 assertion fails.
- [ ] Change only the AVIF speed value to 6.
- [ ] Run focused tests and a real fixture benchmark confirming valid output, substantial time reduction, and acceptable size delta.

### Task 2: Add A Bounded Modern Worker Pool

**Files:**
- Modify: `src/composables/modernImageCompressionWorker.js`
- Modify: `src/composables/modernImageCompressionWorker.test.js`

- [ ] Add failing tests for pool capacity selection, lazy second-worker creation, two concurrent assignments, least-loaded reuse, and single-worker low-CPU fallback.
- [ ] Add failing tests proving one owner's fatal error/timeout rejects only its requests while the other owner completes and replacements remain possible.
- [ ] Replace the single active owner with a maximum-two owner collection and per-owner active request count, preserving all current generation, timer, malformed-message, signature, and transfer safeguards.
- [ ] Run focused and full worker suites.

### Task 3: Process Batches Concurrently And Commit Atomically

**Files:**
- Modify: `src/utils/compressionProfile.js`
- Modify: `src/utils/compressionProfile.test.js`
- Modify: `src/App.vue`
- Modify: `src/composables/useImageProcessor.test.js`

- [ ] Add pure policy tests requiring concurrency 1 for PNG, modern pool capacity for AVIF/JXL, and 4 for native lossy formats.
- [ ] Add an App integration regression using deferred compression promises: two modern jobs start before either resolves, no card changes while work is pending, all cards update after completion, cached cards are skipped, and failures do not block successful results.
- [ ] Implement a small concurrency-limited mapper and replace the sequential loop with collect-then-apply batch orchestration.
- [ ] Preserve snapshotted format/quality and existing notification counts.
- [ ] Run focused tests, full tests, build, and browser benchmarks for one and three real AVIF/JXL images.
- [ ] Request final correctness and performance review.
