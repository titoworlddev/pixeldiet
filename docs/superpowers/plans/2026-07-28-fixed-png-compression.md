# Fixed PNG Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected quality-driven PNG path with the approved fixed 82-color browser-side profile while leaving JPEG/JPG and WebP behavior unchanged.

**Architecture:** A focused PNG module decodes PNG bytes with UPNG, preserves color-management data, quantizes high-color images with `image-q`, and encodes an indexed PNG. The existing reusable worker owns PNG decoding and quantization off the main thread; the composable selects the smaller same-format result, while `App.vue` hides quality controls only for PNG and recognizes the fixed profile independently of other formats' quality values.

**Tech Stack:** Vue 3, Vite 5, Vitest 3, Web Workers, `@upng/upng-js@2.2.2`, `image-q@4.0.0`, `image-resize-compress`.

## Global Constraints

- PNG uses one fixed profile: WuQuant, PNGQuant color distance, at most 82 colors, and Floyd-Steinberg dithering.
- `test_images/Original.png` must produce at most 110,000 bytes and at least 82 % reduction.
- PNG processing remains browser-only, outside the main thread, and never uploads image bytes.
- Preserve dimensions, transparency, and PNG color-management data; remove EXIF and XMP.
- Hide the complete quality-control block for PNG without replacement copy.
- JPEG/JPG and WebP must keep their current `fromBlob` calls, selected quality, bytes, MIME, and download behavior.
- Do not expose worker, codec, library, PSNR, palette, or fallback details in user-facing copy.
- Keep the original same-format PNG whenever the candidate is not smaller.
- Do not commit, amend, push, or open a PR unless the user explicitly requests it.
- Work with the existing dirty worktree; do not revert unrelated changes.

---

## File Map

- `src/utils/constants.js`: shared fixed-profile identifier.
- `src/utils/compressionProfile.js`: format-policy helpers used by the processor and UI.
- `src/utils/compressionProfile.test.js`: fixed-profile and cache-policy tests.
- `src/utils/pngCompression.js`: PNG decode, color normalization, quantization, metadata selection, and encoding.
- `src/utils/pngCompression.test.js`: real codec and fixture regression tests.
- `src/workers/pngCompression.worker.js`: worker orchestration for PNG and non-PNG inputs.
- `src/workers/pngCompression.worker.test.js`: worker routing and normalized error tests.
- `src/composables/pngCompressionWorker.js`: transferable worker client without a quality argument.
- `src/composables/pngCompressionWorker.test.js`: request contract, reuse, and recovery tests.
- `src/composables/useImageProcessor.js`: fixed PNG integration and smaller-original selection.
- `src/composables/useImageProcessor.test.js`: PNG contract plus explicit JPEG/WebP regression tests.
- `src/App.vue`: PNG-only control visibility, cache key, and removal of technical notices.
- `package.json`, `package-lock.json`: add `image-q@4.0.0`.
- `test_images/Original.png`: approved real-world PNG regression fixture.

---

### Task 1: Implement The Fixed PNG Codec

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/utils/constants.js`
- Replace: `src/utils/pngCompression.js`
- Replace: `src/utils/pngCompression.test.js`
- Test: `test_images/Original.png`

**Interfaces:**
- Produces: `PNG_COMPRESSION_PROFILE = 'fixed-png-82-v1'`.
- Produces: `PNG_MAX_COLORS = 82` and `MAX_PNG_PIXELS = 20_000_000`.
- Produces: `decodePng(buffer) -> Promise<{ rgbaBuffer, width, height, colorTabs }>`.
- Produces: `encodeFixedPng(rgbaBuffer, width, height, colorTabs?) -> Promise<{ buffer, width, height, paletteSize, lossless, profile }>`.
- Produces: `compressPngBuffer(buffer) -> Promise<encoded result>` for the worker.

- [ ] **Step 1: Replace the adaptive tests with failing fixed-profile tests**

Replace `src/utils/pngCompression.test.js` with tests that use the real codec and the approved fixture:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import UPNG from '@upng/upng-js/dist/UPNG.esm.js';
import {
  MAX_PNG_PIXELS,
  PNG_MAX_COLORS,
  compressPngBuffer,
  encodeFixedPng
} from './pngCompression';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const toArrayBuffer = bytes =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const fixtureBytes = readFileSync(
  fileURLToPath(new URL('../../test_images/Original.png', import.meta.url))
);
const fixtureBuffer = toArrayBuffer(fixtureBytes);

const chunkTypes = buffer => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const types = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    types.push(
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    );
    offset += length + 12;
  }

  return types;
};

describe('fixed PNG compression', () => {
  it('matches the approved fixture size and indexed-color contract', async () => {
    const original = UPNG.decode(fixtureBuffer);
    const result = await compressPngBuffer(fixtureBuffer);
    const output = UPNG.decode(result.buffer);

    expect([...new Uint8Array(result.buffer).subarray(0, 8)]).toEqual(
      PNG_SIGNATURE
    );
    expect(result.buffer.byteLength).toBeLessThanOrEqual(110_000);
    expect(1 - result.buffer.byteLength / fixtureBytes.byteLength).toBeGreaterThanOrEqual(
      0.82
    );
    expect(output.width).toBe(488);
    expect(output.height).toBe(732);
    expect(output.ctype).toBe(3);
    expect(result.paletteSize).toBeLessThanOrEqual(PNG_MAX_COLORS);
    expect(new Uint8Array(output.tabs.iCCP)).toEqual(
      new Uint8Array(original.tabs.iCCP)
    );
    expect(chunkTypes(result.buffer)).not.toContain('eXIf');
    expect(chunkTypes(result.buffer)).not.toContain('iTXt');
  });

  it('preserves alpha and visible RGB when the source already fits the palette', async () => {
    const width = 16;
    const height = 16;
    const rgba = new Uint8Array(width * height * 4);

    for (let pixel = 0; pixel < width * height; pixel++) {
      const index = pixel * 4;
      rgba[index] = (pixel % 8) * 30;
      rgba[index + 1] = (pixel % 4) * 50;
      rgba[index + 2] = (pixel % 2) * 100;
      rgba[index + 3] = pixel % 7 === 0 ? 0 : 255;
    }

    const result = await encodeFixedPng(rgba.buffer, width, height);
    const decoded = new Uint8Array(
      UPNG.toRGBA8(UPNG.decode(result.buffer))[0]
    );

    expect(result.lossless).toBe(true);
    for (let index = 0; index < rgba.length; index += 4) {
      expect(decoded[index + 3]).toBe(rgba[index + 3]);
      if (rgba[index + 3] > 0) {
        expect([...decoded.subarray(index, index + 3)]).toEqual([
          ...rgba.subarray(index, index + 3)
        ]);
      }
    }
  });

  it('keeps transparency while quantizing a high-color image', async () => {
    const width = 128;
    const height = 128;
    const rgba = new Uint8Array(width * height * 4);

    for (let pixel = 0; pixel < width * height; pixel++) {
      const index = pixel * 4;
      rgba[index] = pixel % 256;
      rgba[index + 1] = (pixel * 7) % 256;
      rgba[index + 2] = (pixel * 13) % 256;
      rgba[index + 3] = pixel % 17 === 0 ? 0 : 255;
    }

    const result = await encodeFixedPng(rgba.buffer, width, height);
    const decoded = new Uint8Array(
      UPNG.toRGBA8(UPNG.decode(result.buffer))[0]
    );

    expect(result.lossless).toBe(false);
    expect(result.paletteSize).toBeLessThanOrEqual(PNG_MAX_COLORS);
    expect(decoded.some((value, index) => index % 4 === 3 && value < 255)).toBe(
      true
    );
    for (let index = 3; index < rgba.length; index += 4) {
      if (rgba[index] === 0) expect(decoded[index]).toBe(0);
    }
  });

  it('rejects invalid dimensions and images above the pixel limit', async () => {
    await expect(encodeFixedPng(new ArrayBuffer(0), 0, 1)).rejects.toMatchObject({
      code: 'INVALID_IMAGE'
    });
    await expect(
      encodeFixedPng(new ArrayBuffer(4), MAX_PNG_PIXELS + 1, 1)
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
  });
});
```

- [ ] **Step 2: Run the codec tests and confirm the old API fails**

Run: `npm test -- src/utils/pngCompression.test.js`

Expected: FAIL because `compressPngBuffer`, `encodeFixedPng`, and `PNG_MAX_COLORS` do not exist yet.

- [ ] **Step 3: Add the MIT quantizer dependency and shared profile constant**

Run: `npm install image-q@4.0.0`

Append to `src/utils/constants.js`:

```js
export const PNG_COMPRESSION_PROFILE = 'fixed-png-82-v1';
```

Expected: `package.json` contains exact dependency version `"image-q": "4.0.0"`, and `package-lock.json` records the same version.

- [ ] **Step 4: Replace the adaptive PNG module with the fixed codec**

Replace `src/utils/pngCompression.js` with:

```js
import { applyPaletteSync, buildPaletteSync, utils } from 'image-q';
import { PNG_COMPRESSION_PROFILE } from './constants';

export const MAX_PNG_PIXELS = 20_000_000;
export const PNG_MAX_COLORS = 82;

const compressionError = (code, message) =>
  Object.assign(new Error(message), { code });

let upngPromise;
const loadUpng = () => {
  if (!('window' in globalThis)) globalThis.window = globalThis;
  upngPromise ??= import('@upng/upng-js/dist/UPNG.esm.js')
    .then(module => module.default)
    .catch(() => {
      upngPromise = undefined;
      throw compressionError('CODEC_LOAD_ERROR', 'No se pudo cargar PNG');
    });
  return upngPromise;
};

const validateRgba = (rgbaBuffer, width, height) => {
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  ) {
    throw compressionError('INVALID_IMAGE', 'Dimensiones no validas');
  }

  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PNG_PIXELS) {
    throw compressionError('IMAGE_TOO_LARGE', 'Imagen demasiado grande');
  }
  if (rgbaBuffer.byteLength !== pixels * 4) {
    throw compressionError('INVALID_IMAGE', 'Datos RGBA no validos');
  }
};

const normalizeHiddenRgb = rgbaBuffer => {
  const rgba = new Uint8Array(rgbaBuffer.slice(0));
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] === 0) rgba.fill(0, index, index + 3);
  }
  return rgba;
};

const countColors = rgba => new Set(new Uint32Array(rgba.buffer)).size;

const selectColorTabs = tabs => {
  if (tabs?.iCCP) return { iCCP: tabs.iCCP };
  if (tabs?.sRGB !== undefined) return { sRGB: tabs.sRGB };
  return {};
};

export async function decodePng(buffer) {
  const UPNG = await loadUpng();
  try {
    const image = UPNG.decode(buffer);
    const rgbaBuffer = UPNG.toRGBA8(image)[0];
    validateRgba(rgbaBuffer, image.width, image.height);
    return {
      rgbaBuffer,
      width: image.width,
      height: image.height,
      colorTabs: selectColorTabs(image.tabs)
    };
  } catch (error) {
    if (error?.code) throw error;
    throw compressionError('INVALID_IMAGE', 'PNG no valido');
  }
}

export async function encodeFixedPng(
  rgbaBuffer,
  width,
  height,
  colorTabs = {}
) {
  validateRgba(rgbaBuffer, width, height);
  const UPNG = await loadUpng();
  const sourceRgba = normalizeHiddenRgb(rgbaBuffer);
  const sourceColors = countColors(sourceRgba);
  let outputRgba = sourceRgba;
  let lossless = sourceColors <= PNG_MAX_COLORS;

  if (!lossless) {
    try {
      const source = utils.PointContainer.fromUint8Array(
        sourceRgba,
        width,
        height
      );
      const palette = buildPaletteSync([source], {
        colorDistanceFormula: 'pngquant',
        paletteQuantization: 'wuquant',
        colors: PNG_MAX_COLORS
      });
      outputRgba = applyPaletteSync(source, palette, {
        colorDistanceFormula: 'pngquant',
        imageQuantization: 'floyd-steinberg'
      }).toUint8Array();
    } catch {
      throw compressionError('ENCODE_ERROR', 'No se pudo comprimir PNG');
    }
  }

  try {
    const buffer = UPNG.encode(
      [outputRgba.buffer],
      width,
      height,
      0,
      undefined,
      colorTabs
    );
    return {
      buffer,
      width,
      height,
      paletteSize: countColors(outputRgba),
      lossless,
      profile: PNG_COMPRESSION_PROFILE
    };
  } catch {
    throw compressionError('ENCODE_ERROR', 'No se pudo comprimir PNG');
  }
}

export async function compressPngBuffer(buffer) {
  const decoded = await decodePng(buffer);
  return encodeFixedPng(
    decoded.rgbaBuffer,
    decoded.width,
    decoded.height,
    decoded.colorTabs
  );
}
```

- [ ] **Step 5: Run the real codec tests**

Run: `npm test -- src/utils/pngCompression.test.js`

Expected: PASS, including an output at or below 110,000 bytes for `Original.png`.

---

### Task 2: Make The Worker Contract Quality-Free

**Files:**
- Modify: `src/workers/pngCompression.worker.js`
- Modify: `src/workers/pngCompression.worker.test.js`
- Modify: `src/composables/pngCompressionWorker.js`
- Modify: `src/composables/pngCompressionWorker.test.js`

**Interfaces:**
- Consumes: `compressPngBuffer(buffer)` and `encodeFixedPng(rgbaBuffer, width, height, tabs)` from Task 1.
- Produces: `compressPngInWorker(blob)` with no quality argument.
- Worker request: `{ id, buffer, mimeType }`.
- Worker response metadata: `{ width, height, paletteSize, lossless, profile }`.

- [ ] **Step 1: Update worker and client tests to reject quality-dependent requests**

In `src/composables/pngCompressionWorker.test.js`, replace every call shaped as:

```js
compressPngInWorker(blob, 75)
```

with:

```js
compressPngInWorker(blob)
```

Update the first request assertion and successful response to:

```js
expect(request).toMatchObject({ mimeType: 'image/png' });
expect(request).not.toHaveProperty('quality');

worker.emitMessage({
  id: request.id,
  ok: true,
  buffer: output,
  width: 10,
  height: 10,
  paletteSize: 82,
  lossless: false,
  profile: 'fixed-png-82-v1'
});

await expect(promise).resolves.toMatchObject({
  width: 10,
  height: 10,
  paletteSize: 82,
  lossless: false,
  profile: 'fixed-png-82-v1'
});
```

Use the same metadata shape in the recovery responses; remove every `psnr` assertion and every quality-specific second request.

Replace `src/workers/pngCompression.worker.test.js` with two routing tests:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('PNG compression worker', () => {
  let messageHandler;
  let workerScope;

  beforeEach(() => {
    vi.resetModules();
    messageHandler = undefined;
    workerScope = {
      addEventListener: vi.fn((type, handler) => {
        if (type === 'message') messageHandler = handler;
      }),
      postMessage: vi.fn()
    };
    vi.stubGlobal('self', workerScope);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('decodes PNG bytes directly without browser rasterization', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    await import('./pngCompression.worker');

    await messageHandler({
      data: {
        id: 7,
        buffer: Uint8Array.from([0, 1, 2, 3]).buffer,
        mimeType: 'image/png'
      }
    });

    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 7,
      ok: false,
      error: { code: 'INVALID_IMAGE', message: expect.any(String) }
    });
  });

  it('normalizes non-PNG browser decode failures', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new DOMException('corrupt', 'DataError'))
    );
    vi.stubGlobal('OffscreenCanvas', class {});
    await import('./pngCompression.worker');

    await messageHandler({
      data: {
        id: 8,
        buffer: Uint8Array.from([0, 1, 2, 3]).buffer,
        mimeType: 'image/jpeg'
      }
    });

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 8,
      ok: false,
      error: { code: 'INVALID_IMAGE', message: expect.any(String) }
    });
  });
});
```

- [ ] **Step 2: Run the worker tests and confirm quality is still present**

Run: `npm test -- src/workers/pngCompression.worker.test.js src/composables/pngCompressionWorker.test.js`

Expected: FAIL because the client still posts `quality` and the worker still uses `encodeAdaptivePng`.

- [ ] **Step 3: Replace worker orchestration with direct PNG decoding and fixed encoding**

Replace `src/workers/pngCompression.worker.js` with:

```js
import {
  MAX_PNG_PIXELS,
  compressPngBuffer,
  encodeFixedPng
} from '../utils/pngCompression';

const APPLICATION_ERROR_CODES = new Set([
  'UNSUPPORTED_BROWSER',
  'IMAGE_TOO_LARGE',
  'INVALID_IMAGE',
  'CODEC_LOAD_ERROR',
  'ENCODE_ERROR'
]);

const failure = (id, code, message) => ({
  id,
  ok: false,
  error: { code, message }
});

const decodeBrowserImage = async (buffer, mimeType) => {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas !== 'function'
  ) {
    throw Object.assign(new Error('Image APIs unavailable'), {
      code: 'UNSUPPORTED_BROWSER'
    });
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }), {
      colorSpaceConversion: 'default',
      premultiplyAlpha: 'none'
    });
  } catch {
    throw Object.assign(new Error('Invalid image'), { code: 'INVALID_IMAGE' });
  }

  try {
    const { width, height } = bitmap;
    if (width * height > MAX_PNG_PIXELS) {
      throw Object.assign(new Error('Image too large'), {
        code: 'IMAGE_TOO_LARGE'
      });
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw Object.assign(new Error('Canvas unavailable'), {
        code: 'UNSUPPORTED_BROWSER'
      });
    }
    context.drawImage(bitmap, 0, 0);
    return {
      rgbaBuffer: context.getImageData(0, 0, width, height).data.buffer,
      width,
      height
    };
  } finally {
    bitmap.close();
  }
};

self.addEventListener('message', async event => {
  const { id, buffer, mimeType } = event.data;
  try {
    const result =
      mimeType === 'image/png'
        ? await compressPngBuffer(buffer)
        : await decodeBrowserImage(buffer, mimeType).then(decoded =>
            encodeFixedPng(
              decoded.rgbaBuffer,
              decoded.width,
              decoded.height,
              { sRGB: 0 }
            )
          );

    self.postMessage({ id, ok: true, ...result }, [result.buffer]);
  } catch (error) {
    const code = APPLICATION_ERROR_CODES.has(error?.code)
      ? error.code
      : 'ENCODE_ERROR';
    self.postMessage(failure(id, code, error?.message || 'PNG error'));
  }
});
```

- [ ] **Step 4: Remove quality from the transferable client**

Change the exported function in `src/composables/pngCompressionWorker.js` to:

```js
export async function compressPngInWorker(blob) {
  if (typeof Worker === 'undefined') {
    throw createError('UNSUPPORTED_BROWSER', 'Web Workers no disponibles');
  }
  const buffer = await blob.arrayBuffer();
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, buffer, mimeType: blob.type }, [buffer]);
    } catch (error) {
      rejectPendingAndResetWorker(
        createError(
          'WORKER_ERROR',
          error?.message || 'No se pudo iniciar la compresion PNG'
        )
      );
    }
  });
}
```

Keep the existing worker reuse, response correlation, pending-request rejection, termination, and recovery code unchanged.

- [ ] **Step 5: Run worker and client tests**

Run: `npm test -- src/workers/pngCompression.worker.test.js src/composables/pngCompressionWorker.test.js`

Expected: PASS with no request object containing `quality` or response containing `psnr`.

---

### Task 3: Integrate The Fixed Profile Without Touching JPEG Or WebP

**Files:**
- Create: `src/utils/compressionProfile.js`
- Create: `src/utils/compressionProfile.test.js`
- Modify: `src/utils/index.js`
- Modify: `src/composables/useImageProcessor.js`
- Modify: `src/composables/useImageProcessor.test.js`

**Interfaces:**
- Consumes: `PNG_COMPRESSION_PROFILE` and `compressPngInWorker(blob)`.
- Produces: `usesFixedPngProfile(format)`, `shouldShowQualityControl(format)`, and `isCompressionCurrent(image, format, quality)`.
- Produces PNG results with `compressedQuality: null` and `compressionProfile: 'fixed-png-82-v1'` after a successful fixed-profile attempt.
- Non-PNG results retain numeric `compressedQuality` and use `compressionProfile: null`.

- [ ] **Step 1: Add failing policy and processor regression tests**

Create `src/utils/compressionProfile.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  isCompressionCurrent,
  shouldShowQualityControl,
  usesFixedPngProfile
} from './compressionProfile';

describe('compression profile policy', () => {
  it('uses one fixed PNG profile and hides PNG quality', () => {
    expect(usesFixedPngProfile('image/png')).toBe(true);
    expect(shouldShowQualityControl('image/png')).toBe(false);
    expect(shouldShowQualityControl('image/webp')).toBe(true);
    expect(shouldShowQualityControl('image/jpeg')).toBe(true);
  });

  it('checks PNG cache by profile and other formats by quality', () => {
    expect(
      isCompressionCurrent(
        {
          isCompressed: true,
          compressedType: 'image/png',
          compressionProfile: 'fixed-png-82-v1',
          compressedQuality: null
        },
        'image/png',
        31
      )
    ).toBe(true);
    expect(
      isCompressionCurrent(
        {
          isCompressed: true,
          compressedType: 'image/webp',
          compressionProfile: null,
          compressedQuality: 75
        },
        'image/webp',
        75
      )
    ).toBe(true);
  });
});
```

In `src/composables/useImageProcessor.test.js`, change the PNG mock to return:

```js
{
  blob: new Blob([Uint8Array.from(PNG_SIGNATURE)], { type: 'image/png' }),
  width: 10,
  height: 10,
  paletteSize: 82,
  lossless: false,
  profile: 'fixed-png-82-v1'
}
```

Assert for PNG:

```js
expect(compressPngInWorkerMock).toHaveBeenCalledWith(expect.any(Blob));
expect(result).toMatchObject({
  compressedType: 'image/png',
  compressedQuality: null,
  compressionProfile: 'fixed-png-82-v1',
  compressionStatus: 'optimized'
});
```

Add explicit unchanged-route regression tests:

```js
it.each([
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp']
])('keeps the existing %s encoder contract', async (format, codec) => {
  await compressImage(jpegImage, format, 61);

  expect(fromBlobMock).toHaveBeenCalledWith(
    expect.any(Blob),
    61,
    'auto',
    'auto',
    codec
  );
  expect(compressPngInWorkerMock).not.toHaveBeenCalled();
});
```

Replace technical error expectations with one generic notice and assert failed PNG attempts have `compressionProfile: null`.

Change the existing small-PNG test so a PNG below 10 KB still invokes
`compressPngInWorkerMock`; retain the early-return assertion for small JPEG or
WebP files instead.

Replace the existing compatible-encoder tests with this worker-unavailable
contract; there is no main-thread PNG fallback:

```js
it('keeps the original when fixed PNG processing is unavailable', async () => {
  compressPngInWorkerMock.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'UNSUPPORTED_BROWSER' })
  );

  const result = await compressImage(pngImage, 'image/png', 75);

  expect(result).toMatchObject({
    compressedSrc: pngImage.src,
    compressedSize: pngImage.originalSize,
    compressedType: 'image/png',
    compressedQuality: null,
    compressionProfile: null,
    compressionStatus: 'unchanged',
    compressionNotice: 'No se pudo comprimir esta imagen.'
  });
  expect(fromBlobMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run policy and processor tests to confirm failure**

Run: `npm test -- src/utils/compressionProfile.test.js src/composables/useImageProcessor.test.js`

Expected: FAIL because the policy module does not exist and PNG still forwards quality.

- [ ] **Step 3: Implement the shared format policy**

Create `src/utils/compressionProfile.js`:

```js
import { PNG_COMPRESSION_PROFILE } from './constants';

export const usesFixedPngProfile = format => format === 'image/png';

export const shouldShowQualityControl = format =>
  !usesFixedPngProfile(format);

export const isCompressionCurrent = (image, format, quality) => {
  if (!image?.isCompressed || image.compressedType !== format) return false;
  return usesFixedPngProfile(format)
    ? image.compressionProfile === PNG_COMPRESSION_PROFILE
    : image.compressedQuality === Number(quality);
};
```

Append to `src/utils/index.js`:

```js
export * from './compressionProfile';
```

- [ ] **Step 4: Update only the PNG portions of `useImageProcessor`**

Import the fixed-profile policy:

```js
import {
  MIME_TO_EXTENSION,
  PNG_COMPRESSION_PROFILE,
  usesFixedPngProfile
} from '../utils';
```

Replace the current notice maps and result helper with:

```js
const GENERIC_ERROR_NOTICE = 'No se pudo comprimir esta imagen.';

const compressionSettings = (format, quality, profileApplied) => ({
  compressedQuality: usesFixedPngProfile(format) ? null : Number(quality),
  compressionProfile:
    usesFixedPngProfile(format) && profileApplied
      ? PNG_COMPRESSION_PROFILE
      : null
});

const originalResult = (
  image,
  format,
  quality,
  notice = null,
  profileApplied = false
) => ({
  compressedSrc: image.src,
  compressedSize: image.originalSize,
  compressedType: image.type,
  ...compressionSettings(format, quality, profileApplied),
  compressionStatus: 'unchanged',
  compressionNotice: notice,
  compressionDetails: null
});
```

Make these exact PNG-specific call changes while leaving `compressJPEG` and `compressWebP` untouched:

```js
// Keep the existing small-file shortcut for every same-format route except PNG.
if (
  !changingFormat &&
  image.originalSize < 10000 &&
  !usesFixedPngProfile(format)
) {
  return originalResult(image, format, quality);
}

// PNG switch branch
const {
  blob: pngBlob,
  notice: pngNotice = null,
  profile: _profile,
  ...pngDetails
} = await compressPNG(blob);

// Successful result
return {
  compressedSrc: base64Data,
  compressedSize: compressedBlob.size,
  compressedType: format,
  ...compressionSettings(format, quality, true),
  compressionStatus: 'optimized',
  compressionNotice,
  compressionDetails
};

// Candidate not smaller
return originalResult(
  image,
  format,
  quality,
  null,
  usesFixedPngProfile(format)
);

// Catch
return originalResult(image, format, quality, GENERIC_ERROR_NOTICE);
```

Replace `compressPNG` with the worker-only fixed profile:

```js
const compressPNG = blob => compressPngInWorker(blob);
```

An unsupported worker is handled by the existing `compressImage` catch: keep
the original and return the generic notice. Do not run the fixed quantizer on
the main thread and do not label the native PNG fallback as the fixed profile.

Do not edit these functions:

```js
const compressWebP = async (blob, quality) => {
  return fromBlob(blob, quality, 'auto', 'auto', 'webp');
};

const compressJPEG = async (blob, quality) => {
  return fromBlob(blob, quality, 'auto', 'auto', 'jpeg');
};
```

- [ ] **Step 5: Run policy, processor, and regression tests**

Run: `npm test -- src/utils/compressionProfile.test.js src/composables/useImageProcessor.test.js`

Expected: PASS, with JPEG and WebP assertions proving unchanged quality arguments.

---

### Task 4: Hide PNG Quality And Remove Internal Copy

**Files:**
- Modify: `src/App.vue:2-17`
- Modify: `src/App.vue:43-64`
- Modify: `src/App.vue:175-204`
- Modify: `src/App.vue:437-473`
- Modify: `src/App.vue:611-617`
- Modify: `src/App.vue:698-703`

**Interfaces:**
- Consumes: `shouldShowQualityControl(format)` and `isCompressionCurrent(image, format, quality)` from Task 3.
- Consumes: top-level result field `compressionProfile` from Task 3.
- Produces: no quality-control DOM for PNG; unchanged quality state and controls for all other formats.

- [ ] **Step 1: Add policy-driven visibility and cache usage**

Extend the import from `./utils`:

```js
import {
  formatBytes,
  calculateReduction,
  FORMAT_OPTIONS,
  MAX_IMAGES,
  MAX_FILE_SIZE,
  MIME_TO_EXTENSION,
  isCompressionCurrent,
  shouldShowQualityControl
} from './utils';
```

Add beside the existing computed values:

```js
const showQualityControl = computed(() =>
  shouldShowQualityControl(selectedFormat.value)
);
```

Replace the current skip condition inside `handleCompressAll` with:

```js
if (
  isCompressionCurrent(
    image,
    selectedFormat.value,
    compressionQuality.value
  )
) {
  continue;
}
```

Store the returned profile with the other result fields:

```js
image.compressionProfile = result.compressionProfile;
```

- [ ] **Step 2: Hide the complete quality block for PNG**

Change the outer quality-control element to:

```vue
<div v-if="showQualityControl">
```

Keep the existing label, percentage, slider, `min="30"`, `max="100"`, and low/high labels inside it. Remove `:aria-describedby` and delete the entire PNG-specific help paragraph. Do not replace either with new copy.

- [ ] **Step 3: Remove per-image implementation notices**

Delete both template blocks shaped as:

```vue
<p v-if="image.compressionNotice" class="mt-1 text-xs text-amber-700">
  {{ image.compressionNotice }}
</p>
```

Keep the size comparison and `Sin cambios` / `Completado` badges unchanged.

- [ ] **Step 4: Run automated tests and compile the Vue template**

Run: `npm test -- src/utils/compressionProfile.test.js src/composables/useImageProcessor.test.js`

Expected: PASS.

Run: `npm run build`

Expected: production build succeeds with no Vue template errors.

- [ ] **Step 5: Verify control visibility in a browser**

Run: `npm run dev -- --host 127.0.0.1 --port 5173`

In the browser:

1. Confirm the default WebP view shows quality `75%`.
2. Select PNG and confirm `Calidad de compresion`, `75%`, the slider, and PNG help text are absent from the DOM.
3. Select WebP again and confirm the slider returns at `75%`.
4. Select JPEG and confirm changing quality still changes the displayed percentage.

Expected: only PNG hides the block; no technical replacement copy appears.

---

### Task 5: Verify The Approved Result End To End

**Files:**
- Verify: `test_images/Original.png`
- Verify: `test_images/imgto.xyz.png`
- Verify: `test_images/pixeldiet.png`
- Verify: all modified source and test files

**Interfaces:**
- Consumes the completed fixed-profile path from Tasks 1-4.
- Produces verification evidence only; no additional feature or refactor.

- [ ] **Step 1: Run the focused PNG suite**

Run:

```bash
npm test -- src/utils/pngCompression.test.js src/workers/pngCompression.worker.test.js src/composables/pngCompressionWorker.test.js src/utils/compressionProfile.test.js src/composables/useImageProcessor.test.js
```

Expected: every focused test passes, including fixture size, ICC, metadata, transparency, worker recovery, fixed-profile cache, and JPEG/WebP regressions.

- [ ] **Step 2: Run the full automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Build production assets**

Run: `npm run build`

Expected: Vite completes successfully and emits the PNG worker plus the main application assets.

- [ ] **Step 4: Reproduce the approved browser result**

With the development server running:

1. Upload `test_images/Original.png`.
2. Select PNG.
3. Confirm no quality control is visible.
4. Compress the image.
5. Confirm the result is at most 110,000 bytes and reports at least 82 % reduction.
6. Download it and verify that it opens, remains 488 by 732 pixels, and visually matches the approved local prototype.

Expected: approximately 105,842 bytes and 83 % reduction; small encoder-version variation is acceptable only within the explicit 110,000-byte limit.

- [ ] **Step 5: Verify privacy and unchanged lossy formats**

In browser DevTools:

1. Clear Network requests.
2. Compress `Original.png` as PNG and confirm no request uploads image bytes or sends a `POST` request.
3. Select WebP, set quality to 75, compress, and confirm its current output path still works.
4. Select JPEG, set quality to 75, compress, and confirm its current output path still works.

Expected: PNG stays local; WebP and JPEG remain functional with their quality controls and existing encoders.

- [ ] **Step 6: Inspect the final worktree without committing**

Run: `git status --short`

Run: `git diff --check`

Run: `git diff -- package.json src/utils/constants.js src/utils/compressionProfile.js src/utils/pngCompression.js src/workers/pngCompression.worker.js src/composables/pngCompressionWorker.js src/composables/useImageProcessor.js src/App.vue`

Expected: no whitespace errors; changes are confined to the approved PNG profile, its UI policy, tests, dependency metadata, and documentation. Leave all files uncommitted unless the user explicitly requests a commit.
