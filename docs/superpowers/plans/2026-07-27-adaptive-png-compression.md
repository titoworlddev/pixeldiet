# Adaptive PNG Compression Implementation Plan

> Superseded by
> `docs/superpowers/specs/2026-07-28-fixed-png-compression-design.md`. Do not
> continue this implementation plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser's ineffective PNG re-encoding with adaptive, local UPNG quantization that produces valid PNG files, large size reductions, and a measured visual-quality floor.

**Architecture:** A pure compression module owns quality policy, PSNR measurement, and UPNG encoding. A reusable Vite module worker decodes images and runs that module away from the main thread; a small client correlates requests and recovers from worker failures. `useImageProcessor` selects the smaller valid result, while `App.vue` distinguishes optimized images from unchanged originals.

**Tech Stack:** Vue 3, Vite 5 module workers, Vitest 3, `@upng/upng-js@2.2.2`, Web Workers, `createImageBitmap`, `OffscreenCanvas`.

## Global Constraints

- Compression must be 100 % browser-side; image bytes must never be uploaded or sent to an API.
- Output selected as PNG must contain the PNG signature `89 50 4E 47 0D 0A 1A 0A`.
- Width and height must not change.
- The alpha channel must remain present; quality 100 must preserve decoded 8-bit RGBA exactly.
- Quality 75 starts at 256 colors and must meet at least 52 dB PSNR.
- Adaptive processing is limited to 20,000,000 pixels per image.
- Process images sequentially and reuse one worker for the batch.
- Preserve the original PNG whenever the candidate is not smaller.
- Do not commit, push, or create a pull request unless the user explicitly asks.

---

## File Map

- Create `src/utils/pngCompression.js`: quality policy, visible-pixel PSNR, adaptive UPNG encoder, validation constants.
- Create `src/utils/pngCompression.test.js`: real-codec unit and integration tests for policy, fidelity, transparency, and PNG validity.
- Create `src/workers/pngCompression.worker.js`: browser decode, pixel-limit enforcement, adaptive encoding, structured responses.
- Create `src/composables/pngCompressionWorker.js`: reusable worker client and request lifecycle.
- Create `src/composables/pngCompressionWorker.test.js`: fake-worker tests for transfer, responses, errors, and restart.
- Modify `vite.config.js`: emit the worker as an ES module so its deferred UPNG import can be split.
- Modify `src/composables/useImageProcessor.js`: route PNG through the worker and return explicit compression status/notices.
- Modify `src/composables/useImageProcessor.test.js`: cover optimized, unchanged, failed, and downloaded PNG outcomes.
- Modify `src/App.vue`: quality help, unchanged status, warning summary, and visible reason for 0 %.
- Modify `package.json` and `package-lock.json`: pin `@upng/upng-js@2.2.2`.

---

### Task 1: Adaptive PNG Algorithm

**Files:**
- Create: `src/utils/pngCompression.js`
- Create: `src/utils/pngCompression.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `MAX_PNG_PIXELS: 20_000_000`.
- Produces: `getPngCompressionPolicy(quality): { quality, paletteSize, minPsnr, lossless }`.
- Produces: `calculateVisiblePsnr(originalBuffer, candidateBuffer): number`.
- Produces: `encodeAdaptivePng(rgbaBuffer, width, height, quality): Promise<{ buffer, paletteSize, psnr, lossless }>`.

- [ ] **Step 1: Install the pinned browser codec**

Run:

```bash
npm install --save-exact @upng/upng-js@2.2.2
```

Expected: `package.json` contains `"@upng/upng-js": "2.2.2"`; only its required runtime packages are added to the lockfile.

- [ ] **Step 2: Write policy and fidelity tests before the module exists**

Create `src/utils/pngCompression.test.js` with boundary cases and real RGBA data:

```js
import { describe, expect, it } from 'vitest';
import UPNG from '@upng/upng-js';
import {
  MAX_PNG_PIXELS,
  calculateVisiblePsnr,
  encodeAdaptivePng,
  getPngCompressionPolicy
} from './pngCompression';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const createGradient = (width, height) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      rgba[index] = (x * 13 + y * 3) % 256;
      rgba[index + 1] = (x * 5 + y * 11) % 256;
      rgba[index + 2] = (x * 7 + y * 17) % 256;
      rgba[index + 3] = x < width / 4 ? 0 : 255;
    }
  }
  return rgba;
};

describe('getPngCompressionPolicy', () => {
  it.each([
    [100, 0, Infinity],
    [99, 1024, 58],
    [95, 1024, 58],
    [94, 512, 55],
    [85, 512, 55],
    [84, 256, 52],
    [70, 256, 52],
    [69, 128, 49],
    [55, 128, 49],
    [54, 64, 46],
    [40, 64, 46],
    [39, 32, 43],
    [30, 32, 43]
  ])('maps quality %s to %s colors', (quality, paletteSize, minPsnr) => {
    expect(getPngCompressionPolicy(quality)).toMatchObject({
      quality,
      paletteSize,
      minPsnr
    });
  });
});

describe('calculateVisiblePsnr', () => {
  it('ignores hidden RGB differences in fully transparent pixels', () => {
    const original = Uint8Array.from([255, 0, 0, 0]).buffer;
    const candidate = Uint8Array.from([0, 255, 255, 0]).buffer;
    expect(calculateVisiblePsnr(original, candidate)).toBe(Infinity);
  });
});

describe('encodeAdaptivePng', () => {
  it('creates a valid PNG meeting the quality-75 threshold', async () => {
    const width = 64;
    const height = 64;
    const rgba = createGradient(width, height);
    const result = await encodeAdaptivePng(rgba.buffer, width, height, 75);
    const bytes = new Uint8Array(result.buffer);
    const decoded = UPNG.decode(result.buffer);

    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(result.psnr).toBeGreaterThanOrEqual(52);
  });

  it('preserves decoded RGBA exactly at quality 100', async () => {
    const width = 32;
    const height = 32;
    const rgba = createGradient(width, height);
    const result = await encodeAdaptivePng(rgba.buffer, width, height, 100);
    const decoded = new Uint8Array(UPNG.toRGBA8(UPNG.decode(result.buffer))[0]);

    expect(decoded).toEqual(rgba);
    expect(result.lossless).toBe(true);
  });

  it(
    'encodes RGBA inputs larger than 10 MB without a browser window global',
    async () => {
      const width = 2048;
      const height = 1281;
      const rgba = createGradient(width, height);
      expect(rgba.byteLength).toBeGreaterThan(10_000_000);

      const result = await encodeAdaptivePng(rgba.buffer, width, height, 100);
      expect([...new Uint8Array(result.buffer).subarray(0, 8)]).toEqual(
        PNG_SIGNATURE
      );
    },
    20_000
  );

  it('rejects images above the pixel limit', async () => {
    await expect(
      encodeAdaptivePng(new ArrayBuffer(4), MAX_PNG_PIXELS + 1, 1, 75)
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
  });
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
npm test -- src/utils/pngCompression.test.js
```

Expected: FAIL because `src/utils/pngCompression.js` does not exist.

- [ ] **Step 4: Implement policy, PSNR, and adaptive encoding**

Create `src/utils/pngCompression.js` with these exact policy values and control flow:

```js
export const MAX_PNG_PIXELS = 20_000_000;
const MAX_PALETTE_SIZE = 4096;

const QUALITY_POLICIES = [
  { minimum: 95, paletteSize: 1024, minPsnr: 58 },
  { minimum: 85, paletteSize: 512, minPsnr: 55 },
  { minimum: 70, paletteSize: 256, minPsnr: 52 },
  { minimum: 55, paletteSize: 128, minPsnr: 49 },
  { minimum: 40, paletteSize: 64, minPsnr: 46 },
  { minimum: 30, paletteSize: 32, minPsnr: 43 }
];

let upngPromise;
const loadUpng = () => {
  if (!('window' in globalThis)) globalThis.window = globalThis;
  upngPromise ??= import('@upng/upng-js').then(module => module.default);
  return upngPromise;
};

export function getPngCompressionPolicy(value) {
  const numericQuality = Number(value);
  const quality = Number.isFinite(numericQuality)
    ? Math.min(100, Math.max(30, Math.round(numericQuality)))
    : 75;

  if (quality === 100) {
    return { quality, paletteSize: 0, minPsnr: Infinity, lossless: true };
  }

  const policy = QUALITY_POLICIES.find(item => quality >= item.minimum);
  return { quality, ...policy, lossless: false };
}

export function calculateVisiblePsnr(originalBuffer, candidateBuffer) {
  const original = new Uint8Array(originalBuffer);
  const candidate = new Uint8Array(candidateBuffer);
  if (original.length !== candidate.length || original.length % 4 !== 0) {
    throw new TypeError('Los buffers RGBA deben tener la misma longitud');
  }

  let squaredError = 0;
  for (let index = 0; index < original.length; index += 4) {
    const originalAlpha = original[index + 3] / 255;
    const candidateAlpha = candidate[index + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      const difference =
        original[index + channel] * originalAlpha -
        candidate[index + channel] * candidateAlpha;
      squaredError += difference * difference;
    }
    const alphaDifference = original[index + 3] - candidate[index + 3];
    squaredError += alphaDifference * alphaDifference;
  }

  if (squaredError === 0) return Infinity;
  const meanSquaredError = squaredError / original.length;
  return 10 * Math.log10((255 * 255) / meanSquaredError);
}

const compressionError = (code, message) => Object.assign(new Error(message), { code });

export async function encodeAdaptivePng(rgbaBuffer, width, height, quality) {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0) {
    throw compressionError('INVALID_IMAGE', 'Las dimensiones no son válidas');
  }
  if (pixels > MAX_PNG_PIXELS) {
    throw compressionError('IMAGE_TOO_LARGE', 'La imagen supera 20 megapíxeles');
  }
  if (rgbaBuffer.byteLength !== pixels * 4) {
    throw compressionError('INVALID_IMAGE', 'El buffer RGBA no coincide con las dimensiones');
  }

  const UPNG = await loadUpng();
  const policy = getPngCompressionPolicy(quality);
  if (policy.lossless) {
    return {
      buffer: UPNG.encode([rgbaBuffer], width, height, 0),
      paletteSize: 0,
      psnr: Infinity,
      lossless: true
    };
  }

  for (
    let paletteSize = policy.paletteSize;
    paletteSize <= MAX_PALETTE_SIZE;
    paletteSize *= 2
  ) {
    const quantized = UPNG.quantize(rgbaBuffer, paletteSize);
    const psnr = calculateVisiblePsnr(rgbaBuffer, quantized.abuf);
    if (psnr >= policy.minPsnr) {
      return {
        buffer: UPNG.encode([quantized.abuf], width, height, 0),
        paletteSize,
        psnr,
        lossless: false
      };
    }
  }

  return {
    buffer: UPNG.encode([rgbaBuffer], width, height, 0),
    paletteSize: 0,
    psnr: Infinity,
    lossless: true
  };
}
```

- [ ] **Step 5: Run focused tests and audit the dependency**

Run:

```bash
npm test -- src/utils/pngCompression.test.js
npm ls @upng/upng-js pako
npm audit
```

Expected: focused tests PASS; UPNG resolves to `2.2.2`; audit introduces no advisory for UPNG or its Pako 2 dependency. Record any unrelated existing advisories rather than running a broad forced upgrade.

- [ ] **Step 6: Review the task diff**

Run:

```bash
git diff --check
git status --short
```

Expected: only package files and the two PNG algorithm files are changed. Do not commit without explicit user approval.

---

### Task 2: Reusable PNG Worker

**Files:**
- Create: `src/workers/pngCompression.worker.js`
- Create: `src/composables/pngCompressionWorker.js`
- Create: `src/composables/pngCompressionWorker.test.js`
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: `MAX_PNG_PIXELS` and `encodeAdaptivePng` from Task 1.
- Produces: `compressPngInWorker(blob, quality): Promise<{ blob, width, height, paletteSize, psnr, lossless }>`.
- Worker request: `{ id, buffer, mimeType, quality }` with transferred input buffer.
- Worker success: `{ id, ok: true, buffer, width, height, paletteSize, psnr, lossless }` with transferred output buffer.
- Worker failure: `{ id, ok: false, error: { code, message } }`.

- [ ] **Step 1: Write fake-worker lifecycle tests**

Create `src/composables/pngCompressionWorker.test.js`. The fake must capture `postMessage`, expose `emitMessage` and `emitError`, and verify these outcomes:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static instances = [];
  constructor() {
    this.listeners = { message: [], error: [] };
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    FakeWorker.instances.push(this);
  }
  addEventListener(type, listener) {
    this.listeners[type].push(listener);
  }
  emitMessage(data) {
    this.listeners.message.forEach(listener => listener({ data }));
  }
  emitError(message) {
    this.listeners.error.forEach(listener => listener({ message }));
  }
}

describe('compressPngInWorker', () => {
  beforeEach(async () => {
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  it('reuses one worker and resolves the matching transferred response', async () => {
    const { compressPngInWorker } = await import('./pngCompressionWorker');
    const promise = compressPngInWorker(
      new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
      75
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    const request = worker.postMessage.mock.calls[0][0];
    const output = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer;
    worker.emitMessage({
      id: request.id,
      ok: true,
      buffer: output,
      width: 10,
      height: 10,
      paletteSize: 256,
      psnr: 53,
      lossless: false
    });

    await expect(promise).resolves.toMatchObject({
      width: 10,
      height: 10,
      paletteSize: 256,
      psnr: 53,
      lossless: false
    });
    expect(worker.postMessage.mock.calls[0][1]).toEqual([request.buffer]);
  });

  it('rejects pending work and recreates the worker after a fatal error', async () => {
    const { compressPngInWorker } = await import('./pngCompressionWorker');
    const first = compressPngInWorker(
      new Blob([Uint8Array.from([1])], { type: 'image/png' }),
      75
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    FakeWorker.instances[0].emitError('worker crashed');
    await expect(first).rejects.toMatchObject({ code: 'WORKER_ERROR' });

    const second = compressPngInWorker(
      new Blob([Uint8Array.from([2])], { type: 'image/png' }),
      75
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const replacement = FakeWorker.instances[1];
    const replacementRequest = replacement.postMessage.mock.calls[0][0];
    replacement.emitMessage({
      id: replacementRequest.id,
      ok: true,
      buffer: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
      width: 1,
      height: 1,
      paletteSize: 0,
      psnr: Infinity,
      lossless: true
    });
    await expect(second).resolves.toMatchObject({ lossless: true });
  });
});
```

- [ ] **Step 2: Run the focused worker-client test and confirm RED**

Run:

```bash
npm test -- src/composables/pngCompressionWorker.test.js
```

Expected: FAIL because `pngCompressionWorker.js` does not exist.

- [ ] **Step 3: Implement the reusable worker client**

Create `src/composables/pngCompressionWorker.js` with module-level `worker`, `nextRequestId`, and `pendingRequests`. Instantiate with:

```js
new Worker(new URL('../workers/pngCompression.worker.js', import.meta.url), {
  type: 'module'
});
```

The exported function must:

```js
export async function compressPngInWorker(blob, quality) {
  if (typeof Worker === 'undefined') {
    throw Object.assign(new Error('Web Workers no disponibles'), {
      code: 'UNSUPPORTED_BROWSER'
    });
  }

  const buffer = await blob.arrayBuffer();
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer, mimeType: blob.type, quality }, [buffer]);
  });
}
```

On success, convert the returned buffer to `new Blob([buffer], { type: 'image/png' })`. On structured failure, reject with an `Error` carrying the worker's `code`. On fatal error, reject every pending request with `WORKER_ERROR`, terminate the worker, clear the map, and set the singleton to `null`.

- [ ] **Step 4: Implement image decode and compression in the worker**

Create `src/workers/pngCompression.worker.js`:

```js
import { MAX_PNG_PIXELS, encodeAdaptivePng } from '../utils/pngCompression';

const failure = (id, code, message) => ({
  id,
  ok: false,
  error: { code, message }
});

self.addEventListener('message', async event => {
  const { id, buffer, mimeType, quality } = event.data;
  let bitmap;
  try {
    if (
      typeof createImageBitmap !== 'function' ||
      typeof OffscreenCanvas !== 'function'
    ) {
      throw Object.assign(new Error('APIs de imagen no disponibles'), {
        code: 'UNSUPPORTED_BROWSER'
      });
    }

    bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }), {
      colorSpaceConversion: 'default',
      premultiplyAlpha: 'none'
    });
    const { width, height } = bitmap;
    if (width * height > MAX_PNG_PIXELS) {
      throw Object.assign(new Error('La imagen supera 20 megapíxeles'), {
        code: 'IMAGE_TOO_LARGE'
      });
    }

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw Object.assign(new Error('Canvas 2D no disponible'), { code: 'UNSUPPORTED_BROWSER' });
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const result = await encodeAdaptivePng(rgba.buffer, width, height, quality);

    self.postMessage(
      { id, ok: true, width, height, ...result },
      [result.buffer]
    );
  } catch (error) {
    self.postMessage(failure(id, error.code || 'ENCODE_ERROR', error.message));
  } finally {
    bitmap?.close();
  }
});
```

- [ ] **Step 5: Configure Vite to emit an ES module worker**

Add the documented worker output format to `vite.config.js` so the worker can contain UPNG's deferred import:

```js
export default defineConfig({
  plugins: [vue()],
  worker: {
    format: 'es'
  },
  // Existing build and server options remain unchanged.
});
```

- [ ] **Step 6: Verify client tests and Vite worker bundling**

Run:

```bash
npm test -- src/composables/pngCompressionWorker.test.js
npm run build
```

Expected: client tests PASS; Vite emits a worker chunk and completes without unresolved worker or UPNG imports.

- [ ] **Step 7: Review the task diff**

Run `git diff --check` and inspect the three new files. Do not commit without explicit user approval.

---

### Task 3: Integrate PNG Results Into Image Processing

**Files:**
- Modify: `src/composables/useImageProcessor.js:1-161`
- Modify: `src/composables/useImageProcessor.test.js`

**Interfaces:**
- Consumes: `compressPngInWorker(blob, quality)` from Task 2.
- Extends every `compressImage` result with `compressionStatus`, `compressionNotice`, `compressedQuality`, and optional `compressionDetails`.
- Status values: `optimized` or `unchanged`.

- [ ] **Step 1: Replace the PNG dependency mock and add status tests**

In `useImageProcessor.test.js`, hoist a `compressPngInWorkerMock`, mock `./pngCompressionWorker`, and preserve the existing `file-saver` assertion:

```js
const { compressPngInWorkerMock, saveAsMock } = vi.hoisted(() => ({
  compressPngInWorkerMock: vi.fn(),
  saveAsMock: vi.fn()
}));

vi.mock('./pngCompressionWorker', () => ({
  compressPngInWorker: compressPngInWorkerMock
}));
```

Add these scenarios:

```js
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const createImage = ({ name, type, size }) => {
  const bytes = new Uint8Array(size);
  if (type === 'image/png') bytes.set(PNG_SIGNATURE);
  else bytes.set([0xff, 0xd8, 0xff]);
  return {
    name,
    type,
    originalSize: size,
    src: `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
  };
};

const jpegImage = createImage({
  name: 'original.jpg',
  type: 'image/jpeg',
  size: 20_001
});
const pngImage = createImage({
  name: 'original.png',
  type: 'image/png',
  size: 20_001
});

let compressImage;
beforeEach(() => {
  compressPngInWorkerMock.mockReset();
  ({ compressImage } = useImageProcessor());
});

it('returns adaptive PNG metadata when the worker reduces the image', async () => {
  compressPngInWorkerMock.mockResolvedValue({
    blob: new Blob([Uint8Array.from(PNG_SIGNATURE)], { type: 'image/png' }),
    width: 10,
    height: 10,
    paletteSize: 256,
    psnr: 53,
    lossless: false
  });
  const result = await compressImage(jpegImage, 'image/png', 75);
  expect(result).toMatchObject({
    compressedType: 'image/png',
    compressedQuality: 75,
    compressionStatus: 'optimized',
    compressionDetails: { paletteSize: 256, psnr: 53, lossless: false }
  });
});

it('keeps an original PNG when the candidate is not smaller', async () => {
  compressPngInWorkerMock.mockResolvedValue({
    blob: new Blob([new Uint8Array(30000)], { type: 'image/png' }),
    paletteSize: 256,
    psnr: 53,
    lossless: false
  });
  const result = await compressImage(pngImage, 'image/png', 75);
  expect(result).toMatchObject({
    compressedSize: pngImage.originalSize,
    compressionStatus: 'unchanged',
    compressionNotice: 'El original ya estaba mejor optimizado.'
  });
});

it('keeps the original and explains worker limits', async () => {
  compressPngInWorkerMock.mockRejectedValue(
    Object.assign(new Error('La imagen supera 20 megapíxeles'), {
      code: 'IMAGE_TOO_LARGE'
    })
  );
  const result = await compressImage(pngImage, 'image/png', 75);
  expect(result).toMatchObject({
    compressionStatus: 'unchanged',
    compressionNotice: 'No se optimizó: la imagen supera 20 megapíxeles.'
  });
});
```

- [ ] **Step 2: Run the processor test and confirm RED**

Run:

```bash
npm test -- src/composables/useImageProcessor.test.js
```

Expected: FAIL because PNG still calls `fromBlob` and results have no status metadata.

- [ ] **Step 3: Route PNG through the worker and return metadata**

Import `compressPngInWorker`. Change `compressPNG` to:

```js
const compressPNG = async (blob, quality) => {
  try {
    return await compressPngInWorker(blob, quality);
  } catch (error) {
    if (error.code !== 'UNSUPPORTED_BROWSER') throw error;
    return {
      blob: await fromBlob(blob, quality, 'auto', 'auto', 'png'),
      paletteSize: null,
      psnr: null,
      lossless: true,
      notice: 'Tu navegador usó el modo PNG compatible.'
    };
  }
};
```

In the PNG switch branch, destructure the result explicitly:

```js
const {
  blob: pngBlob,
  notice: pngNotice = null,
  ...pngDetails
} = await compressPNG(blob, quality);
compressedBlob = pngBlob;
compressionNotice = pngNotice;
compressionDetails = pngDetails;
```

Add an `originalResult(image, quality, notice)` helper returning the original bytes without relabeling them:

```js
const originalResult = (image, quality, notice) => ({
  compressedSrc: image.src,
  compressedSize: image.originalSize,
  compressedType: image.type,
  compressedQuality: Number(quality),
  compressionStatus: 'unchanged',
  compressionNotice: notice,
  compressionDetails: null
});
```

For successful output return:

```js
return {
  compressedSrc: base64Data,
  compressedSize: compressedBlob.size,
  compressedType: format,
  compressedQuality: Number(quality),
  compressionStatus: 'optimized',
  compressionNotice,
  compressionDetails
};
```

Map errors exactly:

```js
const ERROR_NOTICES = {
  IMAGE_TOO_LARGE: 'No se optimizó: la imagen supera 20 megapíxeles.',
  INVALID_IMAGE: 'No se optimizó: la imagen no es válida.',
  ENCODE_ERROR: 'No se optimizó por un error del codificador.',
  WORKER_ERROR: 'No se optimizó por un error del procesador.'
};
```

The existing small-image and larger-output branches must call `originalResult`; the outer catch must use the mapped notice and never relabel original bytes.

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
npm test -- src/composables/useImageProcessor.test.js
npm test
```

Expected: all processor scenarios and the complete suite PASS.

- [ ] **Step 5: Review the task diff**

Run `git diff --check`; inspect `useImageProcessor.js` for a single PNG path and no WebP-to-PNG wrapping. Do not commit without explicit user approval.

---

### Task 4: Explain Unchanged PNGs in the UI

**Files:**
- Modify: `src/App.vue:165-213`
- Modify: `src/App.vue:416-438`
- Modify: `src/App.vue:512-640`

**Interfaces:**
- Consumes: `compressionStatus`, `compressionNotice`, `compressedQuality`, and `compressionDetails` from Task 3.
- Displays: optimized count, unchanged count, PNG quality guidance, and per-image reason.

- [ ] **Step 1: Store status and summarize each batch**

In `handleCompressAll`, replace the single counter with:

```js
let optimizedCount = 0;
let unchangedCount = 0;
```

Change the skip condition so a new quality always produces a new result:

```js
if (
  image.isCompressed &&
  image.compressedType === selectedFormat.value &&
  image.compressedQuality === Number(compressionQuality.value)
) {
  continue;
}
```

After each result, assign:

```js
image.compressionStatus = result.compressionStatus;
image.compressionNotice = result.compressionNotice;
image.compressionDetails = result.compressionDetails;
image.compressedQuality = result.compressedQuality;

if (result.compressionStatus === 'unchanged') unchangedCount++;
else optimizedCount++;
```

Show the current success toast only for `optimizedCount > 0`. Show a second warning toast for unchanged files:

```js
if (unchangedCount > 0) {
  toast.add({
    severity: 'warn',
    summary: 'Original conservado',
    detail: `${unchangedCount} imágenes no consiguieron una versión más pequeña`,
    life: 4000
  });
}
```

- [ ] **Step 2: Clarify PNG quality behavior below the slider**

Immediately below the low/high labels, add:

```vue
<p
  v-if="selectedFormat === 'image/png'"
  class="mt-2 text-xs text-gray-500"
>
  100 % conserva todos los píxeles; valores menores reducen colores de forma
  inteligente sin cambiar dimensiones ni eliminar transparencia.
</p>
```

- [ ] **Step 3: Show `Sin cambios` and the reason in both image layouts**

For each mobile and desktop badge, use:

```vue
<Badge
  v-if="image.isCompressed"
  :severity="image.compressionStatus === 'unchanged' ? 'warning' : 'success'"
  :value="image.compressionStatus === 'unchanged' ? 'Sin cambios' : 'Completado'"
/>
```

Under each size row, render:

```vue
<p
  v-if="image.compressionNotice"
  class="mt-1 text-xs text-amber-700"
>
  {{ image.compressionNotice }}
</p>
```

- [ ] **Step 4: Build and inspect both responsive layouts**

Run:

```bash
npm run build
```

Expected: build PASS. In Chrome, verify the help text appears only for PNG and the reason is readable at 390 px and desktop widths without shifting action buttons out of the card.

- [ ] **Step 5: Review the task diff**

Run `git diff --check`; confirm no unrelated visual changes. Do not commit without explicit user approval.

---

### Task 5: Real Browser and Performance Verification

**Files:**
- Modify only if measured values differ: `docs/superpowers/specs/2026-07-27-adaptive-png-compression-design.md`

**Interfaces:**
- Verifies the complete upload, worker, compression, preview, and download path.

- [ ] **Step 1: Prepare the reproducible PNG fixture outside the repository**

Run:

```bash
sips -s format png screenshot.webp --out /var/folders/xf/gvmck5fj5qn0qh912_4y8r6h0000gn/T/opencode/pixeldiet-source.png
stat -f "%N %z bytes" /var/folders/xf/gvmck5fj5qn0qh912_4y8r6h0000gn/T/opencode/pixeldiet-source.png
```

Expected baseline: approximately 199,812 bytes. Record the actual baseline if macOS produces a different value.

- [ ] **Step 2: Start the app and reproduce quality 75**

Run `npm run dev -- --host 127.0.0.1`. In Chrome DevTools:

1. Upload `pixeldiet-source.png`.
2. Select PNG and quality 75.
3. Compress the image.
4. Confirm the output is below 80,000 bytes and reduction exceeds 50 %.
5. Confirm the badge says `Completado`, not `Sin cambios`.

- [ ] **Step 3: Validate downloaded bytes and decoded dimensions**

Capture the Blob passed to FileSaver or inspect the downloaded file. Assert:

```text
name: pixeldiet-source.png
type: image/png
signature: [137, 80, 78, 71, 13, 10, 26, 10]
dimensions: identical to input
```

Also run the same flow at quality 100 and compare decoded RGBA values exactly.

- [ ] **Step 4: Verify privacy and main-thread responsiveness**

Use Chrome Network and Performance panels:

- The only first-use request may be the application's own worker/chunk asset.
- No request body or URL may contain uploaded image bytes, a data URL, or a remote image service.
- Quantization must execute in the worker thread.
- There must be no quantization long task over 50 ms on the main thread.
- The quality-75 2-megapixel fixture must finish in under 1 second on the current development machine.

- [ ] **Step 5: Verify error and unchanged states**

Test a tiny already-optimized PNG and confirm the original is retained with `Sin cambios` and a reason. Simulate `IMAGE_TOO_LARGE` in the worker-client test and confirm the warning path remains covered.

- [ ] **Step 6: Run final automated verification**

Run:

```bash
npm test
npm run build
git diff --check
npm audit
git status --short
```

Expected: all tests PASS, build PASS, diff check clean, no new UPNG/Pako advisory, and only planned files changed. Report unrelated existing audit findings separately.

- [ ] **Step 7: Perform final code review**

Review tests first, then implementation across correctness, readability, architecture, security, and performance. Required checks:

- No original bytes can be labeled with a different MIME.
- Worker failures reject and reset pending state.
- Pixel limits are checked before allocating RGBA canvas data.
- Every transferred buffer has a single owner after transfer.
- The PNG worker is absent from the initial main bundle.
- The browser test confirms real-codec output rather than a mock.

Address all blocking findings and rerun only the affected focused tests, followed by the full verification commands after the final edit.
