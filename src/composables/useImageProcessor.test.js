import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { useImageProcessor } from './useImageProcessor';

const {
  compressModernImageInWorkerMock,
  compressPngInWorkerMock,
  fromBlobMock,
  saveAsMock,
  toastAddMock
} = vi.hoisted(() => ({
    compressModernImageInWorkerMock: vi.fn(),
    compressPngInWorkerMock: vi.fn(),
    fromBlobMock: vi.fn(),
    saveAsMock: vi.fn(),
    toastAddMock: vi.fn()
  }));

vi.mock('./modernImageCompressionWorker', () => ({
  MODERN_IMAGE_WORKER_POOL_CAPACITY: 2,
  compressModernImageInWorker: compressModernImageInWorkerMock
}));

vi.mock('./pngCompressionWorker', () => ({
  compressPngInWorker: compressPngInWorkerMock
}));

vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAddMock })
}));

vi.mock('primevue/toast', () => ({ default: () => null }));
vi.mock('primevue/button', () => ({ default: () => null }));
vi.mock('primevue/fileupload', () => ({ default: () => null }));
vi.mock('primevue/badge', () => ({ default: () => null }));
vi.mock('primevue/progressbar', () => ({ default: () => null }));

vi.mock('image-resize-compress', () => ({
  fromBlob: fromBlobMock
}));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xd9];
const WEBP_BYTES = [...new TextEncoder().encode('RIFF0000WEBP')];
const AVIF_BYTES = [
  0x00,
  0x00,
  0x00,
  0x10,
  0x66,
  0x74,
  0x79,
  0x70,
  0x61,
  0x76,
  0x69,
  0x66,
  0x00,
  0x00,
  0x00,
  0x00
];
const JXL_BYTES = [0xff, 0x0a, 0xda, 0x16, 0xe0, 0x3c, 0xd8, 0x09];
const MODERN_FORMATS = {
  avif: { bytes: AVIF_BYTES, mimeType: 'image/avif' },
  jxl: { bytes: JXL_BYTES, mimeType: 'image/jxl' }
};
const GENERIC_ERROR_NOTICE = 'No se pudo comprimir esta imagen.';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const modernWorkerResult = (format, size) => {
  const { bytes, mimeType } = MODERN_FORMATS[format];
  const output = new Uint8Array(size);
  output.set(bytes);
  return {
    blob: new Blob([output], { type: mimeType }),
    width: 488,
    height: 732
  };
};

const pngWorkerResult = size => {
  const output = new Uint8Array(size);
  output.set(PNG_SIGNATURE);
  return {
    blob: new Blob([output], { type: 'image/png' }),
    width: 488,
    height: 732,
    paletteSize: 82,
    lossless: false,
    profile: 'fixed-png-82-v1',
    sourceIsPng: true
  };
};

const renderAppBindings = async (App, initialImages, format, quality) => {
  const originalSetup = App.setup;
  let bindings;
  App.setup = (props, context) => {
    bindings = originalSetup(props, context);
    bindings.images.value = initialImages;
    bindings.selectedFormat.value = format;
    bindings.compressionQuality.value = quality;
    return bindings;
  };
  try {
    const renderedApp = createSSRApp(App);
    renderedApp.directive('tooltip', { getSSRProps: () => ({}) });
    await renderToString(renderedApp);
  } finally {
    App.setup = originalSetup;
  }
  return bindings;
};

const createImage = ({ name, type, size, bytes: suppliedBytes }) => {
  const bytes = new Uint8Array(size);
  if (suppliedBytes) bytes.set(suppliedBytes);
  else if (type === 'image/png') bytes.set(PNG_SIGNATURE);
  else bytes.set(JPEG_BYTES);

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

class TestFileReader {
  readAsDataURL(blob) {
    blob
      .arrayBuffer()
      .then(buffer => {
        const result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.({ target: { result } });
      })
      .catch(() => this.onerror?.());
  }
}

describe('useImageProcessor.compressImage', () => {
  let compressImage;
  let downloadSingleImage;
  let downloadAllImages;

  beforeAll(() => {
    vi.stubGlobal('FileReader', TestFileReader);
  });

  beforeEach(() => {
    compressModernImageInWorkerMock.mockReset();
    compressModernImageInWorkerMock.mockImplementation(
      async (_blob, format) => ({
        blob: new Blob([Uint8Array.from(MODERN_FORMATS[format].bytes)], {
          type: MODERN_FORMATS[format].mimeType
        }),
        width: 488,
        height: 732
      })
    );
    compressPngInWorkerMock.mockReset();
    fromBlobMock.mockReset();
    fromBlobMock.mockImplementation(
      async (_blob, _quality, _width, _height, format) => {
        const bytes =
          format === 'png'
            ? PNG_SIGNATURE
            : format === 'jpeg'
              ? JPEG_BYTES
              : WEBP_BYTES;
        return new Blob([Uint8Array.from(bytes)], {
          type: `image/${format}`
        });
      }
    );
    saveAsMock.mockClear();
    toastAddMock.mockClear();
    ({ compressImage, downloadSingleImage, downloadAllImages } =
      useImageProcessor());
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns fixed-profile PNG metadata and downloads real PNG bytes', async () => {
    compressPngInWorkerMock.mockResolvedValue({
      blob: new Blob([Uint8Array.from(PNG_SIGNATURE)], { type: 'image/png' }),
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: false
    });

    const result = await compressImage(jpegImage, 'image/png', 75);
    downloadSingleImage({ ...jpegImage, ...result, isCompressed: true });

    expect(result).toEqual({
      compressedSrc: expect.stringMatching(/^data:image\/png;base64,/),
      compressedSize: PNG_SIGNATURE.length,
      compressedType: 'image/png',
      compressedQuality: null,
      compressionProfile: 'fixed-png-82-v1',
      compressionStatus: 'optimized',
      compressionNotice: null,
      compressionDetails: {
        width: 10,
        height: 10,
        paletteSize: 82,
        lossless: false
      }
    });

    const [downloadedBlob, fileName] = saveAsMock.mock.calls[0];
    const outputBytes = new Uint8Array(await downloadedBlob.arrayBuffer());

    expect(compressPngInWorkerMock).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadedBlob.type).toBe('image/png');
    expect(fileName).toBe('original.png');
    expect([...outputBytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it.each([undefined, null, 'fixed-png-81-v1'])(
    'does not cache a successful PNG with worker profile %s',
    async profile => {
      compressPngInWorkerMock.mockResolvedValue({
        blob: new Blob([Uint8Array.from(PNG_SIGNATURE)], { type: 'image/png' }),
        width: 10,
        height: 10,
        paletteSize: 82,
        lossless: false,
        profile,
        sourceIsPng: false
      });

      const result = await compressImage(jpegImage, 'image/png', 75);

      expect(result).toMatchObject({
        compressedType: 'image/png',
        compressionProfile: null,
        compressionStatus: 'optimized'
      });
    }
  );

  it('uses the fixed worker for a small same-format PNG', async () => {
    const smallPng = createImage({
      name: 'small.png',
      type: 'image/png',
      size: 9_999
    });
    compressPngInWorkerMock.mockResolvedValue({
      blob: new Blob([Uint8Array.from(PNG_SIGNATURE)], { type: 'image/png' }),
      width: 1,
      height: 1,
      paletteSize: 8,
      lossless: true,
      profile: 'fixed-png-82-v1',
      sourceIsPng: true
    });

    const result = await compressImage(smallPng, 'image/png', '82');

    expect(result).toMatchObject({
      compressedType: 'image/png',
      compressedQuality: null,
      compressionProfile: 'fixed-png-82-v1',
      compressionStatus: 'optimized'
    });
    expect(compressPngInWorkerMock).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('keeps the small same-format shortcut for non-PNG images', async () => {
    const smallJpeg = createImage({
      name: 'small.jpg',
      type: 'image/jpeg',
      size: 9_999
    });

    const result = await compressImage(smallJpeg, 'image/jpeg', '82');

    expect(result).toEqual({
      compressedSrc: smallJpeg.src,
      compressedSize: smallJpeg.originalSize,
      compressedType: 'image/jpeg',
      compressedQuality: 82,
      compressionProfile: null,
      compressionStatus: 'unchanged',
      compressionNotice: null,
      compressionDetails: null
    });
    expect(fromBlobMock).not.toHaveBeenCalled();
    expect(compressPngInWorkerMock).not.toHaveBeenCalled();
  });

  it('keeps an original PNG when the candidate is not smaller', async () => {
    compressPngInWorkerMock.mockResolvedValue({
      blob: new Blob([new Uint8Array(30_000)], { type: 'image/png' }),
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: true
    });

    const result = await compressImage(pngImage, 'image/png', '75');

    expect(result).toEqual({
      compressedSrc: pngImage.src,
      compressedSize: pngImage.originalSize,
      compressedType: pngImage.type,
      compressedQuality: null,
      compressionProfile: 'fixed-png-82-v1',
      compressionStatus: 'unchanged',
      compressionNotice: null,
      compressionDetails: null
    });
  });

  it('keeps the original PNG when the candidate has equal size', async () => {
    compressPngInWorkerMock.mockResolvedValue({
      blob: new Blob([new Uint8Array(pngImage.originalSize)], {
        type: 'image/png'
      }),
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: true
    });

    const result = await compressImage(pngImage, 'image/png', 75);

    expect(result).toEqual({
      compressedSrc: pngImage.src,
      compressedSize: pngImage.originalSize,
      compressedType: 'image/png',
      compressedQuality: null,
      compressionProfile: 'fixed-png-82-v1',
      compressionStatus: 'unchanged',
      compressionNotice: null,
      compressionDetails: null
    });
  });

  it('keeps a larger PNG candidate when converting formats', async () => {
    compressPngInWorkerMock.mockResolvedValue({
      blob: new Blob([new Uint8Array(30_000)], { type: 'image/png' }),
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: false
    });

    const result = await compressImage(jpegImage, 'image/png', 75);

    expect(result).toMatchObject({
      compressedSize: 30_000,
      compressedType: 'image/png',
      compressedQuality: null,
      compressionProfile: 'fixed-png-82-v1',
      compressionStatus: 'optimized',
      compressionNotice: null,
      compressionDetails: {
        width: 10,
        height: 10,
        paletteSize: 82,
        lossless: false
      }
    });
  });

  it('retains mislabeled source PNG bytes with PNG metadata when the candidate is larger', async () => {
    const mislabeledPng = createImage({
      name: 'mislabeled.jpg',
      type: 'image/jpeg',
      size: 20_001,
      bytes: PNG_SIGNATURE
    });
    compressPngInWorkerMock.mockResolvedValue({
      blob: new Blob([new Uint8Array(30_000)], { type: 'image/png' }),
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: true
    });

    const result = await compressImage(mislabeledPng, 'image/png', 75);
    downloadSingleImage({ ...mislabeledPng, ...result, isCompressed: true });
    const [downloadedBlob, fileName] = saveAsMock.mock.calls[0];

    expect(result).toMatchObject({
      compressedSrc: expect.stringMatching(/^data:image\/png;base64,/),
      compressedSize: mislabeledPng.originalSize,
      compressedType: 'image/png',
      compressionStatus: 'unchanged'
    });
    expect(downloadedBlob.type).toBe('image/png');
    expect(fileName).toBe('mislabeled.png');
    expect([
      ...new Uint8Array(await downloadedBlob.arrayBuffer()).subarray(0, 8)
    ]).toEqual(PNG_SIGNATURE);
  });

  it('treats mislabeled JPEG bytes as a PNG conversion even when larger', async () => {
    const mislabeledJpeg = createImage({
      name: 'mislabeled.png',
      type: 'image/png',
      size: 20_001,
      bytes: JPEG_BYTES
    });
    const pngCandidate = new Uint8Array(30_000);
    pngCandidate.set(PNG_SIGNATURE);
    compressPngInWorkerMock.mockResolvedValue({
      blob: new Blob([pngCandidate], { type: 'image/png' }),
      width: 10,
      height: 10,
      paletteSize: 82,
      lossless: false,
      profile: 'fixed-png-82-v1',
      sourceIsPng: false
    });

    const result = await compressImage(mislabeledJpeg, 'image/png', 75);
    const outputBytes = Buffer.from(result.compressedSrc.split(',')[1], 'base64');

    expect(result).toMatchObject({
      compressedSize: pngCandidate.byteLength,
      compressedType: 'image/png',
      compressionStatus: 'optimized'
    });
    expect([...outputBytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

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
      compressionNotice: GENERIC_ERROR_NOTICE
    });
    expect(fromBlobMock).not.toHaveBeenCalled();
  });

  it.each([
    'IMAGE_TOO_LARGE',
    'INVALID_IMAGE',
    'CODEC_LOAD_ERROR',
    'ENCODE_ERROR',
    'WORKER_ERROR',
    'WORKER_TIMEOUT'
  ])('uses generic copy and no profile for %s failures', async code => {
    compressPngInWorkerMock.mockRejectedValue(
      Object.assign(new Error(code), { code })
    );

    const result = await compressImage(jpegImage, 'image/png', '75');

    expect(result).toEqual({
      compressedSrc: jpegImage.src,
      compressedSize: jpegImage.originalSize,
      compressedType: 'image/jpeg',
      compressedQuality: null,
      compressionProfile: null,
      compressionStatus: 'unchanged',
      compressionNotice: GENERIC_ERROR_NOTICE,
      compressionDetails: null
    });
  });

  it('returns the complete optimized contract for non-PNG output', async () => {
    const result = await compressImage(jpegImage, 'image/jpeg', '61');

    expect(result).toEqual({
      compressedSrc: expect.stringMatching(/^data:image\/jpeg;base64,/),
      compressedSize: JPEG_BYTES.length,
      compressedType: 'image/jpeg',
      compressedQuality: 61,
      compressionProfile: null,
      compressionStatus: 'optimized',
      compressionNotice: null,
      compressionDetails: null
    });
  });

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

  it.each([
    ['image/avif', 'avif', 35, AVIF_BYTES, 'original.avif'],
    ['image/avif', 'avif', 50, AVIF_BYTES, 'original.avif'],
    ['image/avif', 'avif', 75, AVIF_BYTES, 'original.avif'],
    ['image/jxl', 'jxl', 35, JXL_BYTES, 'original.jxl'],
    ['image/jxl', 'jxl', 50, JXL_BYTES, 'original.jxl'],
    ['image/jxl', 'jxl', 75, JXL_BYTES, 'original.jxl']
  ])(
    'preserves real worker bytes at each approved quality through data URL and individual download',
    async (mimeType, format, quality, expectedBytes, expectedName) => {
      const result = await compressImage(pngImage, mimeType, quality);
      downloadSingleImage({ ...pngImage, ...result, isCompressed: true });

      const encodedBytes = Buffer.from(
        result.compressedSrc.split(',')[1],
        'base64'
      );
      const [downloadedBlob, fileName] = saveAsMock.mock.calls[0];

      expect(compressModernImageInWorkerMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'image/png' }),
        format,
        quality
      );
      expect(fromBlobMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        compressedSrc: expect.stringMatching(
          new RegExp(`^data:${mimeType.replace('/', '\\/')};base64,`)
        ),
        compressedSize: expectedBytes.length,
        compressedType: mimeType,
        compressedQuality: quality,
        compressionProfile: null,
        compressionStatus: 'optimized',
        compressionNotice: null,
        compressionDetails: null,
        ...(format === 'jxl' ? { compressedPreviewSrc: pngImage.src } : {})
      });
      expect([...encodedBytes]).toEqual(expectedBytes);
      expect(result.compressedPreviewSrc).not.toBe(result.compressedSrc);
      expect(downloadedBlob.type).toBe(mimeType);
      expect(fileName).toBe(expectedName);
      expect([...new Uint8Array(await downloadedBlob.arrayBuffer())]).toEqual(
        expectedBytes
      );
    }
  );

  it('stores the exact AVIF and JXL bytes under matching ZIP entry names', async () => {
    const avifImage = createImage({
      name: 'mountain.png',
      type: 'image/png',
      size: 20_001
    });
    const jxlImage = createImage({
      name: 'lake.png',
      type: 'image/png',
      size: 20_001
    });
    const avifResult = await compressImage(avifImage, 'image/avif', 35);
    const jxlResult = await compressImage(jxlImage, 'image/jxl', 75);

    await downloadAllImages([
      { ...avifImage, ...avifResult, isCompressed: true },
      { ...jxlImage, ...jxlResult, isCompressed: true }
    ]);

    const [zipBlob, fileName] = saveAsMock.mock.calls[0];
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const avifBytes = await zip.file('mountain.avif').async('uint8array');
    const jxlBytes = await zip.file('lake.jxl').async('uint8array');

    expect(fileName).toBe('pixeldiet_compressed.zip');
    expect(Object.keys(zip.files)).toEqual(['mountain.avif', 'lake.jxl']);
    expect([...avifBytes]).toEqual(AVIF_BYTES);
    expect([...jxlBytes]).toEqual(JXL_BYTES);
  });

  it.each([
    ['image/avif', 'avif'],
    ['image/jxl', 'jxl']
  ])(
    'keeps original bytes and type when %s worker validation rejects JPEG output',
    async (mimeType, format) => {
      compressModernImageInWorkerMock.mockRejectedValue(
        Object.assign(new Error('JPEG output rejected'), {
          code: 'ENCODE_ERROR',
          rejectedBytes: JPEG_BYTES
        })
      );

      const result = await compressImage(pngImage, mimeType, 50);

      expect(compressModernImageInWorkerMock).toHaveBeenCalledWith(
        expect.any(Blob),
        format,
        50
      );
      expect(fromBlobMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        compressedSrc: pngImage.src,
        compressedSize: pngImage.originalSize,
        compressedType: 'image/png',
        compressedQuality: 50,
        compressionProfile: null,
        compressionStatus: 'unchanged',
        compressionNotice: GENERIC_ERROR_NOTICE,
        compressionDetails: null
      });
      expect([...Buffer.from(result.compressedSrc.split(',')[1], 'base64')]).not.toEqual(
        JPEG_BYTES
      );
    }
  );

  it.each([
    ['image/avif', 'avif', AVIF_BYTES],
    ['image/jxl', 'jxl', JXL_BYTES]
  ])(
    'does not retain a tiny mislabeled JPEG as successful %s output',
    async (mimeType, format, signature) => {
      const mislabeledImage = createImage({
        name: `renamed.${format}`,
        type: mimeType,
        size: 9_000,
        bytes: JPEG_BYTES
      });
      const candidate = new Uint8Array(10_001);
      candidate.set(signature);
      compressModernImageInWorkerMock.mockResolvedValue({
        blob: new Blob([candidate], { type: mimeType }),
        width: 10,
        height: 10
      });

      const result = await compressImage(mislabeledImage, mimeType, 75);
      const outputBytes = Buffer.from(result.compressedSrc.split(',')[1], 'base64');

      expect(compressModernImageInWorkerMock).toHaveBeenCalledWith(
        expect.any(Blob),
        format,
        75
      );
      expect(result).toMatchObject({
        compressedSize: candidate.byteLength,
        compressedType: mimeType,
        compressionStatus: 'optimized'
      });
      expect([...outputBytes.subarray(0, signature.length)]).toEqual(signature);
      expect([...outputBytes.subarray(0, JPEG_BYTES.length)]).not.toEqual(
        JPEG_BYTES
      );
    }
  );

  it.each([
    ['image/avif', 'avif', AVIF_BYTES],
    ['image/jxl', 'jxl', JXL_BYTES]
  ])(
    'retains a genuinely signed %s source when its candidate is not smaller',
    async (mimeType, format, signature) => {
      const sourceImage = createImage({
        name: `source.${format}`,
        type: mimeType,
        size: 20_001,
        bytes: signature
      });
      const candidate = new Uint8Array(30_000);
      candidate.set(signature);
      compressModernImageInWorkerMock.mockResolvedValue({
        blob: new Blob([candidate], { type: mimeType }),
        width: 10,
        height: 10
      });

      const result = await compressImage(sourceImage, mimeType, 50);

      expect(compressModernImageInWorkerMock).toHaveBeenCalledWith(
        expect.any(Blob),
        format,
        50
      );
      expect(result).toMatchObject({
        compressedSrc: sourceImage.src,
        compressedSize: sourceImage.originalSize,
        compressedType: mimeType,
        compressionStatus: 'unchanged',
        compressionNotice: null
      });
    }
  );

  it.each([
    ['image/jpeg', JPEG_BYTES, 'original.jpg'],
    ['image/webp', WEBP_BYTES, 'original.webp']
  ])(
    'downloads %s bytes with matching MIME and filename',
    async (format, expectedBytes, expectedName) => {
      const result = await compressImage(jpegImage, format, 61);
      downloadSingleImage({ ...jpegImage, ...result, isCompressed: true });

      const [downloadedBlob, fileName] = saveAsMock.mock.calls[0];
      expect([...new Uint8Array(await downloadedBlob.arrayBuffer())]).toEqual(
        expectedBytes
      );
      expect(downloadedBlob.type).toBe(format);
      expect(fileName).toBe(expectedName);
    }
  );

  it('does not wrap original PNG bytes in a WebP result', async () => {
    const smallPng = createImage({
      name: 'small.png',
      type: 'image/png',
      size: 9_000
    });
    const webpCandidate = new Uint8Array(10_001);
    webpCandidate.set(WEBP_BYTES);
    fromBlobMock.mockResolvedValue(
      new Blob([webpCandidate], { type: 'image/webp' })
    );

    const result = await compressImage(smallPng, 'image/webp', 75);
    const outputBytes = Buffer.from(result.compressedSrc.split(',')[1], 'base64');

    expect(result).toMatchObject({
      compressedSize: webpCandidate.byteLength,
      compressedType: 'image/webp',
      compressionStatus: 'optimized'
    });
    expect([...outputBytes.subarray(0, WEBP_BYTES.length)]).toEqual(WEBP_BYTES);
  });

  it('keeps original PNG bytes and MIME when WebP encoding fails', async () => {
    const smallPng = createImage({
      name: 'small.png',
      type: 'image/png',
      size: 9_000
    });
    fromBlobMock.mockRejectedValue(
      Object.assign(new Error('encode failed'), { code: 'ENCODE_ERROR' })
    );

    const result = await compressImage(smallPng, 'image/webp', 75);

    expect(result).toEqual({
      compressedSrc: smallPng.src,
      compressedSize: smallPng.originalSize,
      compressedType: 'image/png',
      compressedQuality: 75,
      compressionProfile: null,
      compressionStatus: 'unchanged',
      compressionNotice: GENERIC_ERROR_NOTICE,
      compressionDetails: null
    });
  });

  it('uses the original JXL preview in both layouts and clears it after AVIF recompression', async () => {
    const { default: App } = await import('../App.vue?preview-regression');
    const image = {
      ...pngImage,
      id: 'preview-image',
      isCompressed: true,
      compressedSrc: `data:image/jxl;base64,${Buffer.from(JXL_BYTES).toString('base64')}`,
      compressedPreviewSrc: pngImage.src,
      compressedSize: JXL_BYTES.length,
      compressedType: 'image/jxl',
      compressedQuality: 35,
      compressionProfile: null,
      compressionStatus: 'optimized',
      compressionNotice: null,
      compressionDetails: null
    };
    const originalSetup = App.setup;
    let bindings;
    let html;
    App.setup = (props, context) => {
      bindings = originalSetup(props, context);
      bindings.images.value = [image];
      return bindings;
    };
    try {
      const renderedApp = createSSRApp(App);
      renderedApp.directive('tooltip', { getSSRProps: () => ({}) });
      html = await renderToString(renderedApp);
    } finally {
      App.setup = originalSetup;
    }

    expect(html.split(`src="${pngImage.src}"`)).toHaveLength(3);

    bindings.selectedFormat.value = 'image/avif';
    bindings.compressionQuality.value = 50;
    await bindings.handleCompressAll();

    expect(compressModernImageInWorkerMock).toHaveBeenCalledWith(
      expect.any(Blob),
      'avif',
      50
    );
    expect(image.compressedPreviewSrc).toBeUndefined();
  });

  it.each([
    ['image/avif', 'avif', AVIF_BYTES],
    ['image/jxl', 'jxl', JXL_BYTES]
  ])(
    'retries identical failed same-format %s processing instead of treating it as current',
    async (mimeType, format, bytes) => {
      const { default: App } = await import('../App.vue?failed-cache-regression');
      const image = {
        ...createImage({
          name: `source.${format}`,
          type: mimeType,
          size: 20_001,
          bytes
        }),
        id: `failed-${format}`,
        isCompressed: false
      };
      const originalSetup = App.setup;
      let bindings;
      App.setup = (props, context) => {
        bindings = originalSetup(props, context);
        bindings.images.value = [image];
        bindings.selectedFormat.value = mimeType;
        bindings.compressionQuality.value = 50;
        return bindings;
      };
      try {
        const renderedApp = createSSRApp(App);
        renderedApp.directive('tooltip', { getSSRProps: () => ({}) });
        await renderToString(renderedApp);
      } finally {
        App.setup = originalSetup;
      }
      compressModernImageInWorkerMock.mockRejectedValueOnce(
        Object.assign(new Error('encode failed'), { code: 'ENCODE_ERROR' })
      );

      await bindings.handleCompressAll();

      expect(compressModernImageInWorkerMock).toHaveBeenCalledTimes(1);
      expect(image).toMatchObject({
        isCompressed: true,
        compressedType: mimeType,
        compressedQuality: 50,
        compressionNotice: GENERIC_ERROR_NOTICE
      });

      await bindings.handleCompressAll();

      expect(compressModernImageInWorkerMock).toHaveBeenCalledTimes(2);
      expect(image).toMatchObject({
        compressedType: mimeType,
        compressedQuality: 50,
        compressionStatus: 'optimized',
        compressionNotice: null
      });
    }
  );

  it('limits modern work, commits cards atomically in input order, and preserves batch outcomes', async () => {
    const { default: App } = await import('../App.vue?batch-concurrency-regression');
    const cached = {
      ...pngImage,
      id: 'cached',
      isCompressed: true,
      compressedSrc: 'data:image/avif;base64,Y2FjaGVk',
      compressedSize: 6,
      compressedType: 'image/avif',
      compressedQuality: 75,
      compressionProfile: null,
      compressionStatus: 'optimized',
      compressionNotice: null,
      compressionDetails: null
    };
    const optimized = { ...pngImage, id: 'optimized', name: 'optimized.png' };
    const unchanged = {
      ...createImage({
        name: 'unchanged.avif',
        type: 'image/avif',
        size: 20_001,
        bytes: AVIF_BYTES
      }),
      id: 'unchanged'
    };
    const failed = { ...pngImage, id: 'failed', name: 'failed.png' };
    const cards = [cached, optimized, unchanged, failed];
    const initialCards = cards.map(card => ({ ...card }));
    const jobs = [deferred(), deferred(), deferred()];
    let resolveTwoStarted;
    let resolveThirdStarted;
    const twoStarted = new Promise(resolve => {
      resolveTwoStarted = resolve;
    });
    const thirdStarted = new Promise(resolve => {
      resolveThirdStarted = resolve;
    });
    compressModernImageInWorkerMock.mockImplementation(() => {
      const callIndex = compressModernImageInWorkerMock.mock.calls.length - 1;
      if (callIndex === 1) resolveTwoStarted();
      if (callIndex === 2) resolveThirdStarted();
      return jobs[callIndex].promise;
    });
    const bindings = await renderAppBindings(App, cards, 'image/avif', 75);

    const batch = bindings.handleCompressAll();
    await twoStarted;

    expect(compressModernImageInWorkerMock).toHaveBeenCalledTimes(2);
    expect(bindings.isProcessing.value).toBe(true);
    expect(cards).toEqual(initialCards);

    await bindings.handleCompressAll();
    expect(compressModernImageInWorkerMock).toHaveBeenCalledTimes(2);

    bindings.selectedFormat.value = 'image/jxl';
    bindings.compressionQuality.value = 35;
    jobs[1].resolve(modernWorkerResult('avif', 30_000));
    await thirdStarted;

    expect(compressModernImageInWorkerMock).toHaveBeenCalledTimes(3);
    expect(cards).toEqual(initialCards);
    jobs[2].reject(Object.assign(new Error('encode failed'), { code: 'ENCODE_ERROR' }));
    jobs[0].resolve(modernWorkerResult('avif', 101));
    await batch;

    expect(compressModernImageInWorkerMock.mock.calls).toEqual([
      [expect.any(Blob), 'avif', 75],
      [expect.any(Blob), 'avif', 75],
      [expect.any(Blob), 'avif', 75]
    ]);
    expect(cached).toEqual(initialCards[0]);
    expect(optimized).toMatchObject({
      isCompressed: true,
      compressedSize: 101,
      compressedType: 'image/avif',
      compressedQuality: 75,
      compressionStatus: 'optimized',
      compressionNotice: null
    });
    expect(unchanged).toMatchObject({
      isCompressed: true,
      compressedSrc: unchanged.src,
      compressedSize: unchanged.originalSize,
      compressedType: 'image/avif',
      compressedQuality: 75,
      compressionStatus: 'unchanged',
      compressionNotice: null
    });
    expect(failed).toMatchObject({
      isCompressed: true,
      compressedSrc: failed.src,
      compressedSize: failed.originalSize,
      compressedType: 'image/png',
      compressedQuality: 75,
      compressionStatus: 'unchanged',
      compressionNotice: GENERIC_ERROR_NOTICE
    });
    expect(bindings.isProcessing.value).toBe(false);
    expect(toastAddMock.mock.calls.map(([notification]) => notification)).toEqual([
      {
        severity: 'success',
        summary: 'Compresión completada',
        detail: '1 imágenes comprimidas correctamente',
        life: 3000
      },
      {
        severity: 'warn',
        summary: 'Original conservado',
        detail: '1 imágenes no consiguieron una versión más pequeña',
        life: 4000
      },
      {
        severity: 'error',
        summary: 'Algunas imágenes no se procesaron',
        detail: '1 imágenes no se pudieron comprimir',
        life: 4000
      }
    ]);
  });

  it('runs PNG batch compression one image at a time and applies after the final result', async () => {
    const { default: App } = await import('../App.vue?png-batch-concurrency');
    const first = { ...pngImage, id: 'first', name: 'first.png' };
    const second = { ...pngImage, id: 'second', name: 'second.png' };
    const cards = [first, second];
    const initialCards = cards.map(card => ({ ...card }));
    const jobs = [deferred(), deferred()];
    let resolveFirstStarted;
    let resolveSecondStarted;
    const firstStarted = new Promise(resolve => {
      resolveFirstStarted = resolve;
    });
    const secondStarted = new Promise(resolve => {
      resolveSecondStarted = resolve;
    });
    compressPngInWorkerMock.mockImplementation(() => {
      const callIndex = compressPngInWorkerMock.mock.calls.length - 1;
      if (callIndex === 0) resolveFirstStarted();
      if (callIndex === 1) resolveSecondStarted();
      return jobs[callIndex].promise;
    });
    const bindings = await renderAppBindings(App, cards, 'image/png', 75);

    const batch = bindings.handleCompressAll();
    await firstStarted;

    expect(compressPngInWorkerMock).toHaveBeenCalledOnce();
    expect(cards).toEqual(initialCards);
    jobs[0].resolve(pngWorkerResult(101));
    await secondStarted;

    expect(compressPngInWorkerMock).toHaveBeenCalledTimes(2);
    expect(cards).toEqual(initialCards);
    jobs[1].resolve(pngWorkerResult(102));
    await batch;

    expect(first).toMatchObject({ isCompressed: true, compressedSize: 101 });
    expect(second).toMatchObject({ isCompressed: true, compressedSize: 102 });
  });
});
