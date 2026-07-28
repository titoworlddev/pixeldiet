import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { utils } from 'image-q';
import UPNG from '@upng/upng-js/dist/UPNG.esm.js';
import {
  MAX_IMAGE_Q_PIXELS,
  MAX_PNG_COLOR_CHUNK_BYTES,
  MAX_PNG_PIXELS,
  PNG_MAX_COLORS,
  compressPngBuffer,
  decodePng,
  encodeFixedPng
} from './pngCompression';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

const toArrayBuffer = bytes =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const fixtureBytes = readFileSync(
  fileURLToPath(new URL('../../test_images/Original.png', import.meta.url))
);
const fixtureBuffer = toArrayBuffer(fixtureBytes);

const chunks = buffer => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const chunks = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    chunks.push({
      type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)),
      offset,
      length,
      raw: bytes.slice(offset, end)
    });
    offset = end;
  }

  return chunks;
};

const chunkTypes = buffer => chunks(buffer).map(chunk => chunk.type);

const createChunk = (type, data) => {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(data.length + 8, crc32(chunk.subarray(4, data.length + 8)));
  return chunk;
};

const createPng = rawChunks => {
  const length = PNG_SIGNATURE.length + rawChunks.reduce(
    (total, chunk) => total + chunk.length,
    0
  );
  const png = new Uint8Array(length);
  png.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of rawChunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png.buffer;
};

const rewriteChunkCrc = (bytes, chunk) => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    chunk.offset + chunk.length + 8,
    crc32(bytes.subarray(chunk.offset + 4, chunk.offset + chunk.length + 8))
  );
};

const mutateIhdr = (buffer, mutate) => {
  const bytes = new Uint8Array(buffer.slice(0));
  const ihdr = chunks(bytes.buffer)[0];
  mutate(bytes.subarray(ihdr.offset + 8, ihdr.offset + 8 + ihdr.length));
  rewriteChunkCrc(bytes, ihdr);
  return bytes.buffer;
};

const insertAfterIhdr = (buffer, chunk) => {
  const source = new Uint8Array(buffer);
  const output = new Uint8Array(source.length + chunk.length);
  output.set(source.subarray(0, 33));
  output.set(chunk, 33);
  output.set(source.subarray(33), 33 + chunk.length);
  return output.buffer;
};

const onePixelPng = () =>
  UPNG.encode([Uint8Array.from([10, 20, 30, 255]).buffer], 1, 1, 0);

describe('fixed PNG compression', () => {
  it('rejects an oversized IHDR before invoking UPNG', async () => {
    const png = mutateIhdr(onePixelPng(), data => {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      view.setUint32(0, MAX_PNG_PIXELS + 1);
      view.setUint32(4, 1);
    });

    const decodeSpy = vi.spyOn(UPNG, 'decode').mockImplementation(() => {
      throw new Error('UPNG.decode must not run for an oversized IHDR');
    });
    const toRgbaSpy = vi.spyOn(UPNG, 'toRGBA8');
    let rejection;

    try {
      await decodePng(png);
    } catch (error) {
      rejection = error;
    }

    try {
      expect(decodeSpy).not.toHaveBeenCalled();
      expect(toRgbaSpy).not.toHaveBeenCalled();
      expect(rejection).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    } finally {
      decodeSpy.mockRestore();
      toRgbaSpy.mockRestore();
    }
  });

  it.each([
    ['an illegal truecolor bit depth', data => {
      data[8] = 4;
      data[9] = 2;
    }],
    ['compression method 1', data => {
      data[10] = 1;
    }],
    ['filter method 1', data => {
      data[11] = 1;
    }],
    ['interlace method 2', data => {
      data[12] = 2;
    }]
  ])('rejects %s before invoking UPNG', async (_label, mutate) => {
    const png = mutateIhdr(onePixelPng(), mutate);
    const decodeSpy = vi.spyOn(UPNG, 'decode');

    try {
      await expect(decodePng(png)).rejects.toMatchObject({
        code: 'INVALID_IMAGE'
      });
      expect(decodeSpy).not.toHaveBeenCalled();
    } finally {
      decodeSpy.mockRestore();
    }
  });

  it('rejects malformed chunk bounds before invoking UPNG', async () => {
    const png = new Uint8Array(onePixelPng());
    const idat = chunks(png.buffer).find(chunk => chunk.type === 'IDAT');
    new DataView(png.buffer).setUint32(idat.offset, png.length);
    const decodeSpy = vi.spyOn(UPNG, 'decode');

    try {
      await expect(decodePng(png.buffer)).rejects.toMatchObject({
        code: 'INVALID_IMAGE'
      });
      expect(decodeSpy).not.toHaveBeenCalled();
    } finally {
      decodeSpy.mockRestore();
    }
  });

  it('rejects APNG before invoking UPNG', async () => {
    const apng = insertAfterIhdr(
      onePixelPng(),
      createChunk('acTL', new Uint8Array(8))
    );
    const decodeSpy = vi.spyOn(UPNG, 'decode');

    try {
      await expect(decodePng(apng)).rejects.toMatchObject({
        code: 'INVALID_IMAGE'
      });
      expect(decodeSpy).not.toHaveBeenCalled();
    } finally {
      decodeSpy.mockRestore();
    }
  });

  it.each(['acTL', 'fcTL', 'fdAT'])(
    'rejects the APNG %s chunk before invoking UPNG',
    async type => {
      const png = insertAfterIhdr(
        onePixelPng(),
        createChunk(type, new Uint8Array(type === 'fdAT' ? 8 : 26))
      );
      const decodeSpy = vi.spyOn(UPNG, 'decode');

      try {
        await expect(decodePng(png)).rejects.toMatchObject({
          code: 'INVALID_IMAGE'
        });
        expect(decodeSpy).not.toHaveBeenCalled();
      } finally {
        decodeSpy.mockRestore();
      }
    }
  );

  it.each([
    ['an invalid chunk type letter', 'A1CD'],
    ['a lowercase reserved chunk bit', 'ABcD'],
    ['an unknown critical chunk', 'ABCD']
  ])('rejects %s', async (_label, type) => {
    const png = insertAfterIhdr(
      onePixelPng(),
      createChunk(type, new Uint8Array(0))
    );

    await expect(decodePng(png)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it.each(['IDAT', 'sRGB'])(
    'rejects a corrupted %s CRC before invoking UPNG',
    async type => {
      let png = onePixelPng();
      if (type === 'sRGB') {
        png = insertAfterIhdr(png, createChunk('sRGB', Uint8Array.of(0)));
      }
      const bytes = new Uint8Array(png.slice(0));
      const chunk = chunks(bytes.buffer).find(item => item.type === type);
      bytes[chunk.offset + chunk.length + 11] ^= 1;
      const decodeSpy = vi.spyOn(UPNG, 'decode');

      try {
        await expect(decodePng(bytes.buffer)).rejects.toMatchObject({
          code: 'INVALID_IMAGE'
        });
        expect(decodeSpy).not.toHaveBeenCalled();
      } finally {
        decodeSpy.mockRestore();
      }
    }
  );

  it('rejects duplicate and mutually exclusive retained color chunks', async () => {
    const srgb = createChunk('sRGB', Uint8Array.of(0));
    const iccp = createChunk(
      'iCCP',
      Uint8Array.from([...new TextEncoder().encode('Profile'), 0, 0, 1])
    );

    await expect(
      decodePng(insertAfterIhdr(insertAfterIhdr(onePixelPng(), srgb), srgb))
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(
      decodePng(insertAfterIhdr(insertAfterIhdr(onePixelPng(), iccp), srgb))
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('rejects duplicate IHDR, missing IDAT, trailing IEND, and split IDAT runs', async () => {
    const sourceChunks = chunks(onePixelPng());
    const ihdr = sourceChunks.find(chunk => chunk.type === 'IHDR').raw;
    const idat = sourceChunks.find(chunk => chunk.type === 'IDAT');
    const iend = sourceChunks.find(chunk => chunk.type === 'IEND').raw;
    const idatData = new Uint8Array(onePixelPng()).slice(
      idat.offset + 8,
      idat.offset + 8 + idat.length
    );
    const split = Math.max(1, Math.floor(idatData.length / 2));

    const invalidPngs = [
      createPng([ihdr, ihdr, idat.raw, iend]),
      createPng([ihdr, iend]),
      createPng([ihdr, idat.raw, iend, iend]),
      createPng([
        ihdr,
        createChunk('IDAT', idatData.subarray(0, split)),
        createChunk('tEXt', Uint8Array.from([65, 0, 66])),
        createChunk('IDAT', idatData.subarray(split)),
        iend
      ])
    ];

    for (const png of invalidPngs) {
      await expect(decodePng(png)).rejects.toMatchObject({
        code: 'INVALID_IMAGE'
      });
    }
  });

  it('validates PLTE, tRNS, and color-chunk order and cardinality before UPNG', async () => {
    const sourceChunks = chunks(onePixelPng());
    const ihdr = sourceChunks.find(chunk => chunk.type === 'IHDR').raw;
    const plte = sourceChunks.find(chunk => chunk.type === 'PLTE').raw;
    const idat = sourceChunks.find(chunk => chunk.type === 'IDAT').raw;
    const iend = sourceChunks.find(chunk => chunk.type === 'IEND').raw;
    const trns = createChunk('tRNS', Uint8Array.of(0));
    const srgb = createChunk('sRGB', Uint8Array.of(0));
    const invalidPngs = [
      createPng([ihdr, plte, plte, idat, iend]),
      createPng([ihdr, plte, trns, trns, idat, iend]),
      createPng([ihdr, idat, plte, iend]),
      createPng([ihdr, trns, plte, idat, iend]),
      createPng([ihdr, plte, srgb, idat, iend]),
      createPng([ihdr, idat, iend])
    ];

    for (const png of invalidPngs) {
      const decodeSpy = vi.spyOn(UPNG, 'decode');
      try {
        await expect(decodePng(png)).rejects.toMatchObject({
          code: 'INVALID_IMAGE'
        });
        expect(decodeSpy).not.toHaveBeenCalled();
      } finally {
        decodeSpy.mockRestore();
      }
    }
  });

  it.each([
    ['PLTE in grayscale', 0, createChunk('PLTE', Uint8Array.of(0, 0, 0))],
    ['tRNS in RGBA', 6, createChunk('tRNS', Uint8Array.of(0, 0))]
  ])('rejects illegal %s usage before invoking UPNG', async (_label, colorType, chunk) => {
    const source = mutateIhdr(onePixelPng(), data => {
      data[8] = 8;
      data[9] = colorType;
    });
    const png = insertAfterIhdr(source, chunk);
    const decodeSpy = vi.spyOn(UPNG, 'decode');

    try {
      await expect(decodePng(png)).rejects.toMatchObject({
        code: 'INVALID_IMAGE'
      });
      expect(decodeSpy).not.toHaveBeenCalled();
    } finally {
      decodeSpy.mockRestore();
    }
  });

  it('strips compressed text before UPNG decode', async () => {
    const compressedText = Uint8Array.from([
      ...new TextEncoder().encode('Comment'),
      0,
      0,
      1,
      2,
      3
    ]);
    const png = insertAfterIhdr(
      onePixelPng(),
      createChunk('zTXt', compressedText)
    );

    await expect(decodePng(png)).resolves.toMatchObject({
      width: 1,
      height: 1
    });
  });

  it('rejects an unbounded ICC chunk before invoking UPNG', async () => {
    const profile = new Uint8Array(MAX_PNG_COLOR_CHUNK_BYTES + 1);
    profile.set([0x49, 0, 0]);
    const png = insertAfterIhdr(onePixelPng(), createChunk('iCCP', profile));
    const decodeSpy = vi.spyOn(UPNG, 'decode');

    try {
      await expect(decodePng(png)).rejects.toMatchObject({
        code: 'INVALID_IMAGE'
      });
      expect(decodeSpy).not.toHaveBeenCalled();
    } finally {
      decodeSpy.mockRestore();
    }
  });

  it('matches the approved fixture size and indexed-color contract', async () => {
    const original = UPNG.decode(fixtureBuffer);
    const result = await compressPngBuffer(fixtureBuffer);
    const output = UPNG.decode(result.buffer);

    expect([...new Uint8Array(result.buffer).subarray(0, 8)]).toEqual(
      PNG_SIGNATURE
    );
    expect(result.buffer.byteLength).toBe(105_842);
    expect(result.buffer.byteLength).toBeLessThanOrEqual(110_000);
    expect(
      1 - result.buffer.byteLength / fixtureBytes.byteLength
    ).toBeGreaterThanOrEqual(0.82);
    expect(output.width).toBe(488);
    expect(output.height).toBe(732);
    expect(output.ctype).toBe(3);
    expect(result.paletteSize).toBeLessThanOrEqual(PNG_MAX_COLORS);
    expect(new Uint8Array(output.tabs.iCCP)).toEqual(
      new Uint8Array(original.tabs.iCCP)
    );
    expect(chunks(result.buffer).find(chunk => chunk.type === 'iCCP').raw).toEqual(
      chunks(fixtureBuffer).find(chunk => chunk.type === 'iCCP').raw
    );
    expect(chunkTypes(result.buffer)).not.toContain('eXIf');
    expect(chunkTypes(result.buffer)).not.toContain('iTXt');
  });

  it('writes the requested sRGB declaration for converted images', async () => {
    const rgba = Uint8Array.from([10, 20, 30, 255]);
    const result = await encodeFixedPng(rgba.buffer, 1, 1, { sRGB: 0 });

    expect(chunkTypes(result.buffer)).toContain('sRGB');
    expect(UPNG.decode(result.buffer).tabs.sRGB).toBe(0);
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
      expect(decoded[index]).toBe(rgba[index]);
    }
  });

  it('bounds image-q point containers for large high-color images', async () => {
    const width = 1_000;
    const height = Math.floor(MAX_IMAGE_Q_PIXELS / width) + 1;
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const index = pixel * 4;
      rgba[index] = pixel & 0xff;
      rgba[index + 1] = (pixel >>> 8) & 0xff;
      rgba[index + 2] = (pixel * 31) & 0xff;
      rgba[index + 3] = 255;
    }

    const pointCounts = [];
    const fromUint8Array = utils.PointContainer.fromUint8Array;
    const pointSpy = vi
      .spyOn(utils.PointContainer, 'fromUint8Array')
      .mockImplementation((bytes, imageWidth, imageHeight) => {
        pointCounts.push(bytes.byteLength / 4);
        return fromUint8Array.call(
          utils.PointContainer,
          bytes,
          imageWidth,
          imageHeight
        );
      });

    try {
      const result = await encodeFixedPng(rgba.buffer, width, height);
      expect(result.paletteSize).toBeLessThanOrEqual(PNG_MAX_COLORS);
      expect(pointCounts.length).toBeGreaterThan(1);
      expect(Math.max(...pointCounts)).toBeLessThanOrEqual(MAX_IMAGE_Q_PIXELS);
    } finally {
      pointSpy.mockRestore();
    }
  });

  it('preserves sparse transparent and partial alpha omitted by ordinary sampling', async () => {
    const width = 1_000;
    const height = Math.floor(MAX_IMAGE_Q_PIXELS / width) + 1;
    const pixelCount = width * height;
    const rgba = new Uint8Array(pixelCount * 4);

    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const index = pixel * 4;
      rgba[index] = pixel & 0xff;
      rgba[index + 1] = (pixel >>> 8) & 0xff;
      rgba[index + 2] = (pixel * 31) & 0xff;
      rgba[index + 3] = 255;
    }

    const sampled = new Uint8Array(pixelCount);
    const step = pixelCount / MAX_IMAGE_Q_PIXELS;
    for (let index = 0; index < MAX_IMAGE_Q_PIXELS; index++) {
      sampled[Math.floor(index * step)] = 1;
    }
    const omitted = [];
    for (let pixel = pixelCount - 1; pixel >= 0 && omitted.length < 2; pixel--) {
      if (!sampled[pixel]) omitted.push(pixel);
    }
    const [transparentPixel, partialPixel] = omitted;
    rgba[transparentPixel * 4 + 3] = 0;
    rgba[partialPixel * 4 + 3] = 96;

    const result = await encodeFixedPng(rgba.buffer, width, height);
    const decoded = new Uint8Array(UPNG.toRGBA8(UPNG.decode(result.buffer))[0]);

    expect(result.lossless).toBe(false);
    expect(result.paletteSize).toBeLessThanOrEqual(PNG_MAX_COLORS);
    expect(decoded[transparentPixel * 4 + 3]).toBe(0);
    expect(decoded[partialPixel * 4 + 3]).toBe(96);

    let changedOpaqueAlpha = 0;
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const alphaOffset = pixel * 4 + 3;
      if (rgba[alphaOffset] === 255 && decoded[alphaOffset] !== 255) {
        changedOpaqueAlpha++;
      }
    }
    expect(changedOpaqueAlpha).toBe(0);
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
