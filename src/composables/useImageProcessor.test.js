import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageProcessor } from './useImageProcessor';

const { compressPngInWorkerMock, fromBlobMock, saveAsMock } = vi.hoisted(
  () => ({
    compressPngInWorkerMock: vi.fn(),
    fromBlobMock: vi.fn(),
    saveAsMock: vi.fn()
  })
);

vi.mock('./pngCompressionWorker', () => ({
  compressPngInWorker: compressPngInWorkerMock
}));

vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

vi.mock('image-resize-compress', () => ({
  fromBlob: fromBlobMock
}));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xd9];
const WEBP_BYTES = [...new TextEncoder().encode('RIFF0000WEBP')];
const GENERIC_ERROR_NOTICE = 'No se pudo comprimir esta imagen.';

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

  beforeAll(() => {
    vi.stubGlobal('FileReader', TestFileReader);
  });

  beforeEach(() => {
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
    ({ compressImage, downloadSingleImage } = useImageProcessor());
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
});
