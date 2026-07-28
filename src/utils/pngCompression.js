import { applyPaletteSync, buildPaletteSync, utils } from 'image-q';
import { PNG_COMPRESSION_PROFILE } from './constants';

export const MAX_PNG_PIXELS = 20_000_000;
export const PNG_MAX_COLORS = 82;
export const MAX_IMAGE_Q_PIXELS = 400_000;
export const MAX_PNG_COLOR_CHUNK_BYTES = 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const UPNG_DECODE_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
const CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const APNG_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT']);
const LEGAL_BIT_DEPTHS = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])]
]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

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

const validateDimensions = (width, height) => {
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
  return pixels;
};

const validateRgba = (rgbaBuffer, width, height) => {
  const pixels = validateDimensions(width, height);
  if (rgbaBuffer.byteLength !== pixels * 4) {
    throw compressionError('INVALID_IMAGE', 'Datos RGBA no validos');
  }
};

export const hasPngSignature = buffer => {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < PNG_SIGNATURE.length
  ) {
    return false;
  }

  const bytes = new Uint8Array(buffer);
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
};

const invalidPng = () => compressionError('INVALID_IMAGE', 'PNG no valido');

const calculateCrc = (bytes, start, end) => {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const isLetter = byte =>
  (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);

const validateChunkType = (bytes, offset) => {
  for (let index = offset + 4; index < offset + 8; index++) {
    if (!isLetter(bytes[index])) throw invalidPng();
  }
  if (bytes[offset + 6] < 0x41 || bytes[offset + 6] > 0x5a) {
    throw invalidPng();
  }
};

const validateIccKeyword = (bytes, start, end) => {
  let previousSpace = false;
  for (let index = start; index < end; index++) {
    const byte = bytes[index];
    const isSpace = byte === 0x20;
    const isPrintable =
      isSpace ||
      (byte >= 0x21 && byte <= 0x7e) ||
      (byte >= 0xa1 && byte <= 0xff);
    if (
      !isPrintable ||
      (isSpace && (index === start || index === end - 1 || previousSpace))
    ) {
      throw invalidPng();
    }
    previousSpace = isSpace;
  }
};

const validateTransparency = (
  view,
  dataOffset,
  length,
  colorType,
  bitDepth,
  paletteEntries
) => {
  const sampleMax = bitDepth === 16 ? 0xffff : (1 << bitDepth) - 1;
  if (colorType === 0) {
    if (length !== 2 || view.getUint16(dataOffset) > sampleMax) {
      throw invalidPng();
    }
    return;
  }
  if (colorType === 2) {
    if (length !== 6) throw invalidPng();
    for (let offset = 0; offset < 6; offset += 2) {
      if (view.getUint16(dataOffset + offset) > sampleMax) throw invalidPng();
    }
    return;
  }
  if (
    colorType !== 3 ||
    paletteEntries === 0 ||
    length === 0 ||
    length > paletteEntries
  ) {
    throw invalidPng();
  }
};

const inspectPng = buffer => {
  if (!hasPngSignature(buffer)) {
    throw compressionError('INVALID_IMAGE', 'PNG no valido');
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decodeChunks = [];
  let decodeLength = PNG_SIGNATURE.length;
  let colorChunk = null;
  let hasIcc = false;
  let hasIdat = false;
  let hasIend = false;
  let hasIhdr = false;
  let hasPalette = false;
  let hasSrgb = false;
  let hasTransparency = false;
  let idatEnded = false;
  let bitDepth;
  let colorType;
  let paletteEntries = 0;
  let chunkCount = 0;
  let offset = PNG_SIGNATURE.length;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw invalidPng();

    const length = view.getUint32(offset);
    if (length > 0x7fffffff) throw invalidPng();
    const end = offset + length + 12;
    if (end > bytes.length) throw invalidPng();

    validateChunkType(bytes, offset);

    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    if (calculateCrc(bytes, offset + 4, dataEnd) !== view.getUint32(dataEnd)) {
      throw invalidPng();
    }

    if (chunkCount === 0 && type !== 'IHDR') throw invalidPng();
    if (hasIend || APNG_CHUNKS.has(type)) throw invalidPng();
    if (hasIdat && type !== 'IDAT') idatEnded = true;

    if (type === 'IHDR') {
      if (hasIhdr || chunkCount !== 0 || length !== 13) throw invalidPng();
      bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
      if (
        !LEGAL_BIT_DEPTHS.get(colorType)?.has(bitDepth) ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        bytes[dataOffset + 12] > 1
      ) {
        throw invalidPng();
      }
      validateDimensions(view.getUint32(dataOffset), view.getUint32(dataOffset + 4));
      hasIhdr = true;
    } else if (type === 'PLTE') {
      if (
        hasPalette ||
        hasIdat ||
        hasTransparency ||
        colorType === 0 ||
        colorType === 4 ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        throw invalidPng();
      }
      paletteEntries = length / 3;
      if (colorType === 3 && paletteEntries > 1 << bitDepth) {
        throw invalidPng();
      }
      hasPalette = true;
    } else if (type === 'tRNS') {
      if (hasTransparency || hasIdat || (colorType === 3 && !hasPalette)) {
        throw invalidPng();
      }
      validateTransparency(
        view,
        dataOffset,
        length,
        colorType,
        bitDepth,
        paletteEntries
      );
      hasTransparency = true;
    } else if (type === 'IDAT') {
      if (idatEnded || (colorType === 3 && !hasPalette)) throw invalidPng();
      hasIdat = true;
    } else if (type === 'IEND') {
      if (hasIend || !hasIdat || length !== 0 || end !== bytes.length) {
        throw invalidPng();
      }
      hasIend = true;
    } else if (type === 'iCCP') {
      if (
        hasIcc ||
        hasSrgb ||
        hasPalette ||
        hasIdat ||
        length > MAX_PNG_COLOR_CHUNK_BYTES ||
        length < 4
      ) {
        throw invalidPng();
      }
      let terminator = dataOffset;
      while (terminator < dataEnd && bytes[terminator] !== 0) terminator++;
      const nameLength = terminator - dataOffset;
      if (
        nameLength < 1 ||
        nameLength > 79 ||
        terminator + 2 >= dataEnd ||
        bytes[terminator + 1] !== 0
      ) {
        throw invalidPng();
      }
      validateIccKeyword(bytes, dataOffset, terminator);
      colorChunk = bytes.slice(offset, end);
      hasIcc = true;
    } else if (type === 'sRGB') {
      if (
        hasSrgb ||
        hasIcc ||
        hasPalette ||
        hasIdat ||
        length !== 1 ||
        bytes[dataOffset] > 3
      ) {
        throw invalidPng();
      }
      colorChunk = bytes.slice(offset, end);
      hasSrgb = true;
    } else if ((bytes[offset + 4] & 0x20) === 0 && !CRITICAL_CHUNKS.has(type)) {
      throw invalidPng();
    }

    if (UPNG_DECODE_CHUNKS.has(type)) {
      decodeChunks.push({ offset, end });
      decodeLength += end - offset;
    }

    offset = end;
    chunkCount++;
  }

  if (
    !hasIhdr ||
    !hasIdat ||
    !hasIend ||
    (colorType === 3 && !hasPalette) ||
    offset !== bytes.length
  ) {
    throw invalidPng();
  }

  const sanitized = new Uint8Array(decodeLength);
  sanitized.set(bytes.subarray(0, PNG_SIGNATURE.length));
  let writeOffset = PNG_SIGNATURE.length;
  for (const chunk of decodeChunks) {
    const source = bytes.subarray(chunk.offset, chunk.end);
    sanitized.set(source, writeOffset);
    writeOffset += source.length;
  }

  return {
    sanitizedBuffer: sanitized.buffer,
    colorTabs: colorChunk ? { rawChunk: colorChunk } : {}
  };
};

const normalizeHiddenRgb = rgbaBuffer => {
  const rgba = new Uint8Array(rgbaBuffer.slice(0));
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] === 0) rgba.fill(0, index, index + 3);
  }
  return rgba;
};

const countColorsUpTo = (rgba, limit = PNG_MAX_COLORS + 1) => {
  const colors = new Set();
  const pixels = new Uint32Array(
    rgba.buffer,
    rgba.byteOffset,
    rgba.byteLength / Uint32Array.BYTES_PER_ELEMENT
  );
  for (const pixel of pixels) {
    colors.add(pixel);
    if (colors.size >= limit) return colors.size;
  }
  return colors.size;
};

const paletteOptions = {
  colorDistanceFormula: 'pngquant',
  paletteQuantization: 'wuquant',
  colors: PNG_MAX_COLORS
};

const imageOptions = {
  colorDistanceFormula: 'pngquant',
  imageQuantization: 'floyd-steinberg'
};

const buildPalette = (rgba, width, height, colors = PNG_MAX_COLORS) => {
  const source = utils.PointContainer.fromUint8Array(rgba, width, height);
  return buildPaletteSync([source], { ...paletteOptions, colors });
};

const alphaRepresentatives = rgba => {
  let transparent = null;
  let partial = null;
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    const alpha = rgba[offset + 3];
    if (alpha === 0 && !transparent) {
      transparent = rgba.slice(offset, offset + 4);
    } else if (alpha > 0 && alpha < 255 && !partial) {
      partial = rgba.slice(offset, offset + 4);
    }
    if (transparent && partial) break;
  }
  return [transparent, partial].filter(Boolean);
};

const sampleRgba = rgba => {
  const pixelCount = rgba.byteLength / 4;
  const sample = new Uint8Array(MAX_IMAGE_Q_PIXELS * 4);
  const step = pixelCount / MAX_IMAGE_Q_PIXELS;
  for (let index = 0; index < MAX_IMAGE_Q_PIXELS; index++) {
    const sourceOffset = Math.floor(index * step) * 4;
    sample.set(rgba.subarray(sourceOffset, sourceOffset + 4), index * 4);
    sample[index * 4 + 3] = 255;
  }
  return sample;
};

const applyPaletteInTiles = (rgba, width, height, palette) => {
  const output = new Uint8Array(rgba.byteLength);
  const tileWidth = Math.min(width, MAX_IMAGE_Q_PIXELS);
  const tileHeight = Math.max(1, Math.floor(MAX_IMAGE_Q_PIXELS / tileWidth));

  for (let top = 0; top < height; top += tileHeight) {
    const currentHeight = Math.min(tileHeight, height - top);
    for (let left = 0; left < width; left += tileWidth) {
      const currentWidth = Math.min(tileWidth, width - left);
      const tile = new Uint8Array(currentWidth * currentHeight * 4);
      for (let row = 0; row < currentHeight; row++) {
        const sourceOffset = ((top + row) * width + left) * 4;
        const tileOffset = row * currentWidth * 4;
        tile.set(
          rgba.subarray(sourceOffset, sourceOffset + currentWidth * 4),
          tileOffset
        );
      }

      const source = utils.PointContainer.fromUint8Array(
        tile,
        currentWidth,
        currentHeight
      );
      const quantized = applyPaletteSync(
        source,
        palette,
        imageOptions
      ).toUint8Array();
      for (let row = 0; row < currentHeight; row++) {
        const outputOffset = ((top + row) * width + left) * 4;
        const tileOffset = row * currentWidth * 4;
        output.set(
          quantized.subarray(tileOffset, tileOffset + currentWidth * 4),
          outputOffset
        );
      }
      // image-q caches corrected colors; clear that cache at each tile boundary.
      palette.sort();
    }
  }

  return output;
};

const quantizeRgba = (rgba, width, height) => {
  const pixelCount = width * height;
  if (pixelCount <= MAX_IMAGE_Q_PIXELS) {
    const source = utils.PointContainer.fromUint8Array(rgba, width, height);
    const palette = buildPaletteSync([source], paletteOptions);
    return applyPaletteSync(source, palette, imageOptions).toUint8Array();
  }

  const representatives = alphaRepresentatives(rgba);
  const sample = sampleRgba(rgba);
  const palette = buildPalette(
    sample,
    MAX_IMAGE_Q_PIXELS,
    1,
    PNG_MAX_COLORS - representatives.length
  );
  for (const color of representatives) {
    const point = utils.Point.createByRGBA(...color);
    if (!palette.has(point)) palette.add(point);
  }
  if (representatives.length > 0) palette.sort();
  return applyPaletteInTiles(rgba, width, height, palette);
};

const reinsertColorChunk = (buffer, rawChunk) => {
  if (!rawChunk) return buffer;
  const png = new Uint8Array(buffer);
  const output = new Uint8Array(png.length + rawChunk.length);
  output.set(png.subarray(0, 33));
  output.set(rawChunk, 33);
  output.set(png.subarray(33), 33 + rawChunk.length);
  return output.buffer;
};

export async function decodePng(buffer) {
  try {
    const { sanitizedBuffer, colorTabs } = inspectPng(buffer);
    const UPNG = await loadUpng();
    const image = UPNG.decode(sanitizedBuffer);
    const rgbaBuffer = UPNG.toRGBA8(image)[0];
    validateRgba(rgbaBuffer, image.width, image.height);
    return {
      rgbaBuffer,
      width: image.width,
      height: image.height,
      colorTabs
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
  const sourceColors = countColorsUpTo(sourceRgba);
  let outputRgba = sourceRgba;
  const lossless = sourceColors <= PNG_MAX_COLORS;

  if (!lossless) {
    try {
      outputRgba = quantizeRgba(sourceRgba, width, height);
    } catch {
      throw compressionError('ENCODE_ERROR', 'No se pudo comprimir PNG');
    }
  }

  try {
    const rawColorChunk = colorTabs?.rawChunk;
    const buffer = UPNG.encode(
      [outputRgba.buffer],
      width,
      height,
      0,
      undefined,
      rawColorChunk ? {} : colorTabs
    );
    return {
      buffer: reinsertColorChunk(buffer, rawColorChunk),
      width,
      height,
      paletteSize: countColorsUpTo(outputRgba),
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
