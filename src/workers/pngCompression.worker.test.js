import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UPNG from '@upng/upng-js/dist/UPNG.esm.js';

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const onePixelPng = () =>
  UPNG.encode([Uint8Array.from([10, 20, 30, 255]).buffer], 1, 1, 0);

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

  it('decodes a PNG signature directly without browser rasterization', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    await import('./pngCompression.worker');

    await messageHandler({
      data: {
        id: 7,
        buffer: Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
        ]).buffer,
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

  it('routes a mislabeled PNG signature through the pre-decode size guard', async () => {
    const png = new Uint8Array(onePixelPng());
    const view = new DataView(png.buffer);
    view.setUint32(16, 20_000_001);
    view.setUint32(20, 1);
    view.setUint32(29, crc32(png.subarray(12, 29)));
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('OffscreenCanvas', class {});
    await import('./pngCompression.worker');

    await messageHandler({
      data: { id: 9, buffer: png.buffer, mimeType: 'image/jpeg' }
    });

    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 9,
      ok: false,
      error: { code: 'IMAGE_TOO_LARGE', message: expect.any(String) }
    });
  });

  it('reports signature-derived PNG provenance for a mislabeled PNG', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    await import('./pngCompression.worker');

    await messageHandler({
      data: { id: 10, buffer: onePixelPng(), mimeType: 'image/jpeg' }
    });

    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(workerScope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 10,
      ok: true,
      sourceIsPng: true
    });
  });

  it('reports conversion provenance for non-PNG bytes mislabeled as PNG', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 1, height: 1, close })
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {
            drawImage: vi.fn(),
            getImageData: () => ({
              data: Uint8ClampedArray.from([10, 20, 30, 255])
            })
          };
        }
      }
    );
    await import('./pngCompression.worker');

    await messageHandler({
      data: {
        id: 11,
        buffer: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
        mimeType: 'image/png'
      }
    });

    expect(workerScope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 11,
      ok: true,
      sourceIsPng: false
    });
    expect(close).toHaveBeenCalledOnce();
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
