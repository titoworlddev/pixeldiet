import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MODERN_IMAGE_PIXELS,
  encodeModernImage,
  hasModernImageSignature
} from './modernImageCompression';

const { avifEncode, jxlEncode } = vi.hoisted(() => ({
  avifEncode: vi.fn(),
  jxlEncode: vi.fn()
}));

vi.mock('@jsquash/avif', () => ({ encode: avifEncode }));
vi.mock('@jsquash/jxl', () => ({ encode: jxlEncode }));

const ascii = value => Uint8Array.from(value, character => character.charCodeAt(0));

const makeAvif = (majorBrand, compatibleBrands = []) => {
  const bytes = new Uint8Array(16 + compatibleBrands.length * 4);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(ascii('ftyp'), 4);
  bytes.set(ascii(majorBrand), 8);
  compatibleBrands.forEach((brand, index) => {
    bytes.set(ascii(brand), 16 + index * 4);
  });
  return bytes.buffer;
};

const makeExtendedAvif = (majorBrand, compatibleBrands = []) => {
  const bytes = new Uint8Array(24 + compatibleBrands.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1);
  bytes.set(ascii('ftyp'), 4);
  view.setBigUint64(8, BigInt(bytes.length));
  bytes.set(ascii(majorBrand), 16);
  compatibleBrands.forEach((brand, index) => {
    bytes.set(ascii(brand), 24 + index * 4);
  });
  return bytes.buffer;
};

const JXL_CONTAINER_SIGNATURE = Uint8Array.from([
  0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a
]).buffer;
const JXL_CODESTREAM_SIGNATURE = Uint8Array.from([0xff, 0x0a, 0x01]).buffer;
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]).buffer;
const imageData = {
  data: new Uint8ClampedArray([10, 20, 30, 255]),
  width: 1,
  height: 1
};

beforeEach(() => {
  avifEncode.mockReset();
  jxlEncode.mockReset();
  avifEncode.mockResolvedValue(makeAvif('avif'));
  jxlEncode.mockResolvedValue(JXL_CODESTREAM_SIGNATURE);
});

describe('encodeModernImage', () => {
  it('exports the approved decoded-pixel ceiling', () => {
    expect(MAX_MODERN_IMAGE_PIXELS).toBe(20_000_000);
  });

  it('encodes AVIF with the approved quality policy', async () => {
    const output = await encodeModernImage(imageData, 'avif', 35);

    expect(avifEncode).toHaveBeenCalledWith(imageData, {
      quality: 35,
      qualityAlpha: 35,
      speed: 6,
      bitDepth: 8,
      lossless: false
    });
    expect(jxlEncode).not.toHaveBeenCalled();
    expect(output).toBe(await avifEncode.mock.results[0].value);
  });

  it('encodes JPEG XL with the approved quality policy', async () => {
    const output = await encodeModernImage(imageData, 'jxl', 75);

    expect(jxlEncode).toHaveBeenCalledWith(imageData, {
      quality: 75,
      effort: 7,
      lossless: false
    });
    expect(avifEncode).not.toHaveBeenCalled();
    expect(output).toBe(await jxlEncode.mock.results[0].value);
  });

  it.each([
    undefined,
    null,
    '',
    '35',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    101
  ])('rejects invalid quality %j before loading a codec', async quality => {
    await expect(
      encodeModernImage(imageData, 'avif', quality)
    ).rejects.toMatchObject({ code: 'INVALID_QUALITY' });
    expect(avifEncode).not.toHaveBeenCalled();
    expect(jxlEncode).not.toHaveBeenCalled();
  });

  it('rejects unsupported formats before loading a codec', async () => {
    await expect(
      encodeModernImage(imageData, 'webp', 50)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(avifEncode).not.toHaveBeenCalled();
    expect(jxlEncode).not.toHaveBeenCalled();
  });

  it.each([
    ['avif', avifEncode],
    ['jxl', jxlEncode]
  ])('rejects invalid %s output instead of relabeling it', async (format, encode) => {
    encode.mockResolvedValue(JPEG_SIGNATURE);

    await expect(
      encodeModernImage(imageData, format, 50)
    ).rejects.toMatchObject({ code: 'ENCODE_ERROR' });
  });

  it.each([
    ['avif', avifEncode],
    ['jxl', jxlEncode]
  ])(
    'normalizes a rejected %s encoder initialization or encode promise',
    async (format, encode) => {
      encode.mockRejectedValue(new Error('private codec detail'));

      await expect(
        encodeModernImage(imageData, format, 50)
      ).rejects.toMatchObject({ code: 'CODEC_LOAD_ERROR' });
    }
  );

  it('normalizes a rejected codec import', async () => {
    vi.resetModules();
    vi.doMock('@jsquash/avif', () => {
      throw new Error('private import detail');
    });
    const { encodeModernImage: encodeWithImportFailure } = await import(
      './modernImageCompression?codec-import-failure'
    );

    await expect(
      encodeWithImportFailure(imageData, 'avif', 50)
    ).rejects.toMatchObject({ code: 'CODEC_LOAD_ERROR' });
  });
});

describe('hasModernImageSignature', () => {
  it.each([
    ['avif major brand', makeAvif('avif')],
    ['avis major brand', makeAvif('avis')],
    ['avif compatible brand', makeAvif('mif1', ['miaf', 'avif'])],
    ['avis compatible brand', makeAvif('mif1', ['miaf', 'avis'])],
    [
      'avif compatible brand in an extended-size ftyp box',
      makeExtendedAvif('mif1', ['avif'])
    ]
  ])('accepts an AVIF %s', (_label, buffer) => {
    expect(hasModernImageSignature(buffer, 'avif')).toBe(true);
  });

  it.each([
    ['raw codestream', JXL_CODESTREAM_SIGNATURE],
    ['container', JXL_CONTAINER_SIGNATURE]
  ])('accepts a JPEG XL %s signature', (_label, buffer) => {
    expect(hasModernImageSignature(buffer, 'jxl')).toBe(true);
  });

  it.each(['avif', 'jxl'])(
    'rejects JPEG bytes for the %s target',
    format => {
      expect(hasModernImageSignature(JPEG_SIGNATURE, format)).toBe(false);
    }
  );

  it('only checks AVIF compatible brands inside the declared ftyp box', () => {
    const ftyp = new Uint8Array(makeAvif('mif1'));
    const bytes = new Uint8Array(ftyp.length + 4);
    bytes.set(ftyp);
    bytes.set(ascii('avif'), ftyp.length);

    expect(hasModernImageSignature(bytes.buffer, 'avif')).toBe(false);
  });

  it('rejects a truncated AVIF ftyp box', () => {
    const bytes = new Uint8Array(makeAvif('mif1', ['avif']));
    new DataView(bytes.buffer).setUint32(0, bytes.length + 4);

    expect(hasModernImageSignature(bytes.buffer, 'avif')).toBe(false);
  });

  it.each([
    [new ArrayBuffer(0), 'avif'],
    [Uint8Array.from([0xff, 0x0b]).buffer, 'jxl'],
    [JXL_CONTAINER_SIGNATURE.slice(0, 11), 'jxl'],
    [makeAvif('avif'), 'webp']
  ])('rejects malformed or unsupported signature input', (buffer, format) => {
    expect(hasModernImageSignature(buffer, format)).toBe(false);
  });
});
