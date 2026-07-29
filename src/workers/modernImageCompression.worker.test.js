import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { encodeModernImage } = vi.hoisted(() => ({
  encodeModernImage: vi.fn()
}));

vi.mock('../utils/modernImageCompression', () => ({
  MAX_MODERN_IMAGE_PIXELS: 20_000_000,
  encodeModernImage
}));

describe('modern image compression worker', () => {
  let messageHandler;
  let workerScope;

  beforeEach(() => {
    vi.resetModules();
    encodeModernImage.mockReset();
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

  it('reconstructs the source Blob, rasterizes RGBA, and transfers AVIF output', async () => {
    const source = Uint8Array.from([1, 2, 3, 4]);
    const imageData = {
      data: Uint8ClampedArray.from([10, 20, 30, 128, 40, 50, 60, 255]),
      width: 2,
      height: 1
    };
    const encoded = Uint8Array.from([0, 0, 0, 16]).buffer;
    const close = vi.fn();
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => imageData);
    const getContext = vi.fn(() => ({ drawImage, getImageData }));
    const OffscreenCanvas = vi.fn(function(width, height) {
      this.width = width;
      this.height = height;
      this.getContext = getContext;
    });
    const createImageBitmap = vi.fn(async blob => {
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/png');
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...source]);
      return { width: 2, height: 1, close };
    });
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvas);
    encodeModernImage.mockResolvedValue(encoded);
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 11,
        buffer: source.buffer,
        mimeType: 'image/png',
        format: 'avif',
        quality: 35
      }
    });

    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
      colorSpaceConversion: 'default',
      premultiplyAlpha: 'none'
    });
    expect(OffscreenCanvas).toHaveBeenCalledWith(2, 1);
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 2 }), 0, 0);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(encodeModernImage).toHaveBeenCalledOnce();
    expect(encodeModernImage).toHaveBeenCalledWith(imageData, 'avif', 35);
    expect(close).toHaveBeenCalledOnce();
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      {
        id: 11,
        ok: true,
        buffer: encoded,
        mimeType: 'image/avif',
        width: 2,
        height: 1
      },
      [encoded]
    );
  });

  it('routes JPEG XL through the selected encoder and returns exact MIME and dimensions', async () => {
    const imageData = {
      data: Uint8ClampedArray.from([10, 20, 30, 255]),
      width: 1,
      height: 1
    };
    const encoded = Uint8Array.from([0xff, 0x0a]).buffer;
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
            getImageData: () => imageData
          };
        }
      }
    );
    encodeModernImage.mockResolvedValue(encoded);
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 12,
        buffer: new ArrayBuffer(1),
        mimeType: 'image/jpeg',
        format: 'jxl',
        quality: 75
      }
    });

    expect(encodeModernImage).toHaveBeenCalledOnce();
    expect(encodeModernImage).toHaveBeenCalledWith(imageData, 'jxl', 75);
    expect(close).toHaveBeenCalledOnce();
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      {
        id: 12,
        ok: true,
        buffer: encoded,
        mimeType: 'image/jxl',
        width: 1,
        height: 1
      },
      [encoded]
    );
  });

  it('returns a structured generic decode failure without leaking details', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new DOMException('private decoder detail', 'DataError'))
    );
    vi.stubGlobal('OffscreenCanvas', class {});
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 13,
        buffer: new ArrayBuffer(1),
        mimeType: 'image/png',
        format: 'avif',
        quality: 50
      }
    });

    expect(encodeModernImage).not.toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 13,
      ok: false,
      code: 'INVALID_IMAGE'
    });
  });

  it('closes the bitmap and returns a structured generic rasterization failure', async () => {
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
            getImageData: () => {
              throw new Error('private canvas detail');
            }
          };
        }
      }
    );
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 14,
        buffer: new ArrayBuffer(1),
        mimeType: 'image/png',
        format: 'avif',
        quality: 50
      }
    });

    expect(close).toHaveBeenCalledOnce();
    expect(encodeModernImage).not.toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 14,
      ok: false,
      code: 'INVALID_IMAGE'
    });
  });

  it('closes the bitmap and preserves fatal codec-load failures', async () => {
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
              data: Uint8ClampedArray.from([10, 20, 30, 255]),
              width: 1,
              height: 1
            })
          };
        }
      }
    );
    encodeModernImage.mockRejectedValue(
      Object.assign(new Error('private WASM detail'), {
        code: 'CODEC_LOAD_ERROR'
      })
    );
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 15,
        buffer: new ArrayBuffer(1),
        mimeType: 'image/png',
        format: 'jxl',
        quality: 50
      }
    });

    expect(close).toHaveBeenCalledOnce();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 15,
      ok: false,
      code: 'CODEC_LOAD_ERROR'
    });
  });

  it('allows the exact decoded-pixel ceiling without allocating real pixels', async () => {
    const close = vi.fn();
    const imageData = {
      data: new Uint8ClampedArray(4),
      width: 20_000_000,
      height: 1
    };
    const encoded = Uint8Array.from([0xff, 0x0a]).buffer;
    const OffscreenCanvas = vi.fn(function() {
      this.getContext = () => ({
        drawImage: vi.fn(),
        getImageData: () => imageData
      });
    });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 20_000_000, height: 1, close })
    );
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvas);
    encodeModernImage.mockResolvedValue(encoded);
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 17,
        buffer: new ArrayBuffer(1),
        mimeType: 'image/png',
        format: 'jxl',
        quality: 50
      }
    });

    expect(OffscreenCanvas).toHaveBeenCalledWith(20_000_000, 1);
    expect(encodeModernImage).toHaveBeenCalledWith(imageData, 'jxl', 50);
    expect(close).toHaveBeenCalledOnce();
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 17, ok: true, width: 20_000_000, height: 1 }),
      [encoded]
    );
  });

  it('rejects one pixel over the ceiling before constructing OffscreenCanvas', async () => {
    const close = vi.fn();
    const OffscreenCanvas = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 20_000_001, height: 1, close })
    );
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvas);
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 18,
        buffer: new ArrayBuffer(1),
        mimeType: 'image/png',
        format: 'avif',
        quality: 50
      }
    });

    expect(OffscreenCanvas).not.toHaveBeenCalled();
    expect(encodeModernImage).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 18,
      ok: false,
      code: 'IMAGE_TOO_LARGE'
    });
  });

  it.each([
    ['zero width', 0, 1],
    ['negative height', 1, -1],
    ['fractional width', 1.5, 1],
    ['NaN height', 1, Number.NaN],
    ['infinite width', Number.POSITIVE_INFINITY, 1],
    ['unsafe width', Number.MAX_SAFE_INTEGER + 1, 1]
  ])(
    'rejects %s before constructing OffscreenCanvas',
    async (_label, width, height) => {
      const close = vi.fn();
      const OffscreenCanvas = vi.fn();
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn().mockResolvedValue({ width, height, close })
      );
      vi.stubGlobal('OffscreenCanvas', OffscreenCanvas);
      await import('./modernImageCompression.worker');

      await messageHandler({
        data: {
          id: 19,
          buffer: new ArrayBuffer(1),
          mimeType: 'image/png',
          format: 'avif',
          quality: 50
        }
      });

      expect(OffscreenCanvas).not.toHaveBeenCalled();
      expect(encodeModernImage).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
      expect(workerScope.postMessage).toHaveBeenCalledWith({
        id: 19,
        ok: false,
        code: 'IMAGE_TOO_LARGE'
      });
    }
  );

  it.each(['constructor', '__proto__'])(
    'rejects inherited-property format %s before decode',
    async format => {
      const createImageBitmap = vi.fn();
      vi.stubGlobal('createImageBitmap', createImageBitmap);
      vi.stubGlobal('OffscreenCanvas', class {});
      await import('./modernImageCompression.worker');

      await messageHandler({
        data: {
          id: 20,
          buffer: new ArrayBuffer(1),
          mimeType: 'image/png',
          format,
          quality: 50
        }
      });

      expect(createImageBitmap).not.toHaveBeenCalled();
      expect(workerScope.postMessage).toHaveBeenCalledWith({
        id: 20,
        ok: false,
        code: 'UNSUPPORTED_FORMAT'
      });
    }
  );

  it.each([
    ['null data', { data: null }],
    ['missing data', {}],
    ['null event', null],
    ['invalid request id', { data: { id: 0, format: 'avif' } }]
  ])('returns a structured failure for %s', async (_label, event) => {
    await import('./modernImageCompression.worker');

    await expect(messageHandler(event)).resolves.toBeUndefined();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: event?.data?.id,
      ok: false,
      code: 'INVALID_IMAGE'
    });
  });

  it('reports unsupported browser image APIs with a structured code', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);
    await import('./modernImageCompression.worker');

    await messageHandler({
      data: {
        id: 16,
        buffer: new ArrayBuffer(1),
        mimeType: 'image/png',
        format: 'avif',
        quality: 50
      }
    });

    expect(encodeModernImage).not.toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      id: 16,
      ok: false,
      code: 'UNSUPPORTED_BROWSER'
    });
  });
});
