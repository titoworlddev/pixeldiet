const AVIF_BRANDS = new Set(['avif', 'avis']);
const JXL_CONTAINER_SIGNATURE = [
  0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a
];

export const MAX_MODERN_IMAGE_PIXELS = 20_000_000;

const compressionError = (code, message) =>
  Object.assign(new Error(message), { code });

const matchesBytes = (bytes, signature) =>
  bytes.length >= signature.length &&
  signature.every((byte, index) => bytes[index] === byte);

const readBrand = (bytes, offset) =>
  String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );

const hasAvifSignature = buffer => {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 16) return false;

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (readBrand(bytes, 4) !== 'ftyp') return false;

  let boxSize = view.getUint32(0);
  let headerSize = 8;
  if (boxSize === 1) {
    if (bytes.length < 24) return false;
    const extendedSize = view.getBigUint64(8);
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
    boxSize = Number(extendedSize);
    headerSize = 16;
  } else if (boxSize === 0) {
    boxSize = bytes.length;
  }

  const brandsOffset = headerSize;
  const compatibleBrandsOffset = brandsOffset + 8;
  if (
    boxSize < compatibleBrandsOffset ||
    boxSize > bytes.length ||
    (boxSize - compatibleBrandsOffset) % 4 !== 0
  ) {
    return false;
  }

  if (AVIF_BRANDS.has(readBrand(bytes, brandsOffset))) return true;
  for (let offset = compatibleBrandsOffset; offset < boxSize; offset += 4) {
    if (AVIF_BRANDS.has(readBrand(bytes, offset))) return true;
  }
  return false;
};

const hasJxlSignature = buffer => {
  if (!(buffer instanceof ArrayBuffer)) return false;
  const bytes = new Uint8Array(buffer);
  return (
    (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) ||
    matchesBytes(bytes, JXL_CONTAINER_SIGNATURE)
  );
};

export const hasModernImageSignature = (buffer, format) => {
  if (format === 'avif') return hasAvifSignature(buffer);
  if (format === 'jxl') return hasJxlSignature(buffer);
  return false;
};

export async function encodeModernImage(imageData, format, quality) {
  if (format !== 'avif' && format !== 'jxl') {
    throw compressionError('UNSUPPORTED_FORMAT', 'Formato no compatible');
  }
  if (
    typeof quality !== 'number' ||
    !Number.isFinite(quality) ||
    quality < 0 ||
    quality > 100
  ) {
    throw compressionError('INVALID_QUALITY', 'Calidad no valida');
  }

  const numericQuality = quality;
  let output;
  try {
    if (format === 'avif') {
      const { encode } = await import('@jsquash/avif');
      output = await encode(imageData, {
        quality: numericQuality,
        qualityAlpha: numericQuality,
        speed: 6,
        bitDepth: 8,
        lossless: false
      });
    } else {
      const { encode } = await import('@jsquash/jxl');
      output = await encode(imageData, {
        quality: numericQuality,
        effort: 7,
        lossless: false
      });
    }
  } catch {
    throw compressionError('CODEC_LOAD_ERROR', 'No se pudo cargar el codec');
  }

  if (!hasModernImageSignature(output, format)) {
    throw compressionError('ENCODE_ERROR', 'Salida de imagen no valida');
  }
  return output;
}
