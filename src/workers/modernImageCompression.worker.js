import {
  MAX_MODERN_IMAGE_PIXELS,
  encodeModernImage
} from '../utils/modernImageCompression';

const MIME_TYPES = new Map([
  ['avif', 'image/avif'],
  ['jxl', 'image/jxl']
]);

const KNOWN_ERROR_CODES = new Set([
  'UNSUPPORTED_BROWSER',
  'IMAGE_TOO_LARGE',
  'INVALID_IMAGE',
  'UNSUPPORTED_FORMAT',
  'INVALID_QUALITY',
  'CODEC_LOAD_ERROR',
  'ENCODE_ERROR'
]);

const compressionError = code => Object.assign(new Error(code), { code });

const rasterizeImage = async (buffer, mimeType) => {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas !== 'function'
  ) {
    throw compressionError('UNSUPPORTED_BROWSER');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }), {
      colorSpaceConversion: 'default',
      premultiplyAlpha: 'none'
    });
  } catch {
    throw compressionError('INVALID_IMAGE');
  }

  try {
    const { width, height } = bitmap;
    if (
      !Number.isSafeInteger(width) ||
      width <= 0 ||
      !Number.isSafeInteger(height) ||
      height <= 0 ||
      width * height > MAX_MODERN_IMAGE_PIXELS
    ) {
      throw compressionError('IMAGE_TOO_LARGE');
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw compressionError('UNSUPPORTED_BROWSER');

    context.drawImage(bitmap, 0, 0);
    return {
      imageData: context.getImageData(0, 0, width, height),
      width,
      height
    };
  } catch (error) {
    if (
      error?.code === 'UNSUPPORTED_BROWSER' ||
      error?.code === 'IMAGE_TOO_LARGE'
    ) {
      throw error;
    }
    throw compressionError('INVALID_IMAGE');
  } finally {
    bitmap.close();
  }
};

self.addEventListener('message', async event => {
  let id;
  try {
    const request = event?.data;
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw compressionError('INVALID_IMAGE');
    }

    const { buffer, mimeType, format, quality } = request;
    id = request.id;
    if (!Object.hasOwn(request, 'id') || !Number.isSafeInteger(id) || id <= 0) {
      throw compressionError('INVALID_IMAGE');
    }

    const outputMimeType = MIME_TYPES.get(format);
    if (!outputMimeType) throw compressionError('UNSUPPORTED_FORMAT');

    const { imageData, width, height } = await rasterizeImage(buffer, mimeType);
    const output = await encodeModernImage(imageData, format, quality);
    self.postMessage(
      {
        id,
        ok: true,
        buffer: output,
        mimeType: outputMimeType,
        width,
        height
      },
      [output]
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      code: KNOWN_ERROR_CODES.has(error?.code) ? error.code : 'ENCODE_ERROR'
    });
  }
});
