# Real AVIF And JPEG XL Encoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit genuine AVIF and JPEG XL files instead of JPEG bytes with renamed extensions.

**Architecture:** A dedicated module worker decodes source images to RGBA and dynamically loads the selected jSquash WASM encoder. The processor receives only signature-validated bytes and keeps download data separate from the JXL display fallback.

**Tech Stack:** Vue 3, Vite 5 module workers, Vitest, Web Workers, OffscreenCanvas, `@jsquash/avif@2.1.1`, `@jsquash/jxl@1.3.0`.

## Global Constraints

- Keep processing entirely local; no image upload or remote encoding API.
- Pin exact codec versions and load them only from the selected worker path.
- Map Baja/Media/Alta directly to quality 35/50/75.
- Use AVIF speed 4, 8-bit output, and matching alpha quality.
- Use JPEG XL effort 7 and lossy output.
- Cap decoded AVIF/JXL input at exactly 20,000,000 pixels before canvas
  allocation.
- Accept output only after validating a real AVIF or JXL signature.
- Keep original preview for JXL while downloading real JXL bytes.
- Do not change PNG, JPEG, or WebP algorithms or their existing tests.
- Use generic existing error copy and never fall back to disguised JPEG.
- Do not commit, stage, reset, revert, or push.

---

### Task 1: Add Real Codec Policy And Signature Validation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/utils/modernImageCompression.js`
- Create: `src/utils/modernImageCompression.test.js`
- Modify: `public/THIRD_PARTY_NOTICES.txt`
- Modify: `vite.config.js`

**Interfaces:**
- Produces: `encodeModernImage(imageData, format, quality): Promise<ArrayBuffer>`.
- Produces: `hasModernImageSignature(buffer, format): boolean`.
- Accepts formats `avif` and `jxl`; all others reject with `UNSUPPORTED_FORMAT`.

- [ ] **Step 1: Install exact codecs**

Run:

```bash
npm install --save-exact @jsquash/avif@2.1.1 @jsquash/jxl@1.3.0
```

Verify package and lockfile contain exact versions, then read both installed
license files before updating the notice.

- [ ] **Step 2: Write failing codec-policy tests**

Mock each dynamic encoder and assert:

```js
await encodeModernImage(imageData, 'avif', 35);
expect(avifEncode).toHaveBeenCalledWith(imageData, {
  quality: 35,
  qualityAlpha: 35,
  speed: 4,
  bitDepth: 8,
  lossless: false
});

await encodeModernImage(imageData, 'jxl', 75);
expect(jxlEncode).toHaveBeenCalledWith(imageData, {
  quality: 75,
  effort: 7,
  lossless: false
});
```

Add table tests for AVIF `ftyp` major/compatible brands, JXL raw/container
signatures, JPEG rejection for both targets, invalid quality, and unsupported
format.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- src/utils/modernImageCompression.test.js`

Expected: failure because the module does not exist.

- [ ] **Step 4: Implement the minimal codec policy**

Use dynamic imports inside the selected branch:

```js
if (format === 'avif') {
  const { encode } = await import('@jsquash/avif');
  output = await encode(imageData, {
    quality: numericQuality,
    qualityAlpha: numericQuality,
    speed: 4,
    bitDepth: 8,
    lossless: false
  });
} else if (format === 'jxl') {
  const { encode } = await import('@jsquash/jxl');
  output = await encode(imageData, {
    quality: numericQuality,
    effort: 7,
    lossless: false
  });
}
```

Validate the returned ArrayBuffer signature before returning it. Configure Vite
to include WASM assets and append the exact Apache-2.0 package notices.

- [ ] **Step 5: Verify Task 1**

Run focused tests, `npm run build`, and `git diff --check`. Confirm WASM files
are emitted as production assets and neither codec enters the main entry chunk.

---

### Task 2: Run Modern Encoders In A Recoverable Worker

**Files:**
- Create: `src/workers/modernImageCompression.worker.js`
- Create: `src/workers/modernImageCompression.worker.test.js`
- Create: `src/composables/modernImageCompressionWorker.js`
- Create: `src/composables/modernImageCompressionWorker.test.js`

**Interfaces:**
- Produces: `compressModernImageInWorker(blob, format, quality): Promise<{ blob, width, height }>`.
- Worker request: `{ id, buffer, mimeType, format, quality }`.
- Worker success: `{ id, ok: true, buffer, mimeType, width, height }`.
- Worker failure: `{ id, ok: false, code }`.

- [ ] **Step 1: Write failing worker tests**

Cover source Blob reconstruction, `createImageBitmap`, OffscreenCanvas RGBA
rasterization, AVIF/JXL routing, dimensions, exact MIME, output buffer transfer,
structured decode/encode errors, worker timeout, stale event isolation, timer
cleanup, termination, and replacement.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- src/workers/modernImageCompression.worker.test.js src/composables/modernImageCompressionWorker.test.js
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement worker rasterization**

Reconstruct the Blob, decode it with `createImageBitmap`, draw it to an
`OffscreenCanvas`, read RGBA `ImageData`, call `encodeModernImage`, close the
bitmap in `finally`, and transfer only the encoded ArrayBuffer back. Before
constructing `OffscreenCanvas`, require positive safe-integer dimensions and a
decoded pixel count no greater than exactly 20,000,000.

- [ ] **Step 4: Implement client lifecycle**

Follow the generation-scoped PNG worker pattern: one lazily constructed module
worker, a pending-request map, a named five-minute timeout, listener setup made
atomic, stale worker events ignored, pending timers cleared on every terminal
path, and replacement allowed after failure.

- [ ] **Step 5: Verify Task 2**

Run both focused suites, then `npm test`, `npm run build`, and
`git diff --check`.

---

### Task 3: Integrate Real Bytes, JXL Preview, And Downloads

**Files:**
- Modify: `src/composables/useImageProcessor.js`
- Modify: `src/composables/useImageProcessor.test.js`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `compressModernImageInWorker(blob, format, quality)`.
- Adds optional result field: `compressedPreviewSrc`.
- Keeps `compressedSrc` as the sole source for individual and ZIP downloads.

- [ ] **Step 1: Write failing processor regressions**

Replace AVIF/JXL expectations that use `fromBlob` with worker expectations.
Assert real fixture signatures survive data URL conversion and individual
downloads, output Blob MIME/name matches `.avif` or `.jxl`, ZIP entries contain
the same bytes, JPEG bytes are rejected rather than relabeled, and JXL returns
`compressedPreviewSrc: image.src` without replacing `compressedSrc`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/composables/useImageProcessor.test.js`

Expected: AVIF/JXL still call `fromBlob` and lack preview separation.

- [ ] **Step 3: Integrate the worker**

Route only AVIF/JXL through `compressModernImageInWorker`. Remove the fake
`compressAVIF` and `compressJXL` wrappers. Preserve numeric quality metadata and
return the worker Blob's exact MIME. Set `compressedPreviewSrc` only for JXL.

- [ ] **Step 4: Render the safe preview**

For both mobile and desktop thumbnails, use:

```vue
:src="image.compressedPreviewSrc || (image.isCompressed ? image.compressedSrc : image.src)"
```

Store the optional field after compression without changing download logic.

- [ ] **Step 5: Verify real browser outputs**

Using `test_images/Original.png`, encode AVIF and JXL at Baja, Media, and Alta.
Inspect the in-memory/download bytes for valid signatures, matching MIME and
extensions, preserved 488x732 dimensions and transparency behavior, sensible
quality/size progression, original JXL preview, and no external image upload or
POST request.

- [ ] **Step 6: Complete verification**

Run `npm test`, `npm run build`, `git diff --check`, inspect production WASM
assets and third-party notices, then request an independent holistic review.
