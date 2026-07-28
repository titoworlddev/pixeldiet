import {
  MAX_PNG_PIXELS,
  compressPngBuffer,
  encodeFixedPng,
  hasPngSignature
} from '../utils/pngCompression';

const APPLICATION_ERROR_CODES = new Set([
  'UNSUPPORTED_BROWSER',
  'IMAGE_TOO_LARGE',
  'INVALID_IMAGE',
  'CODEC_LOAD_ERROR',
  'ENCODE_ERROR'
]);

const failure = (id, code, message) => ({
  id,
  ok: false,
  error: { code, message }
});

const decodeBrowserImage = async (buffer, mimeType) => {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas !== 'function'
  ) {
    throw Object.assign(new Error('Image APIs unavailable'), {
      code: 'UNSUPPORTED_BROWSER'
    });
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }), {
      colorSpaceConversion: 'default',
      premultiplyAlpha: 'none'
    });
  } catch {
    throw Object.assign(new Error('Invalid image'), { code: 'INVALID_IMAGE' });
  }

  try {
    const { width, height } = bitmap;
    if (width * height > MAX_PNG_PIXELS) {
      throw Object.assign(new Error('Image too large'), {
        code: 'IMAGE_TOO_LARGE'
      });
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw Object.assign(new Error('Canvas unavailable'), {
        code: 'UNSUPPORTED_BROWSER'
      });
    }
    context.drawImage(bitmap, 0, 0);
    return {
      rgbaBuffer: context.getImageData(0, 0, width, height).data.buffer,
      width,
      height
    };
  } finally {
    bitmap.close();
  }
};

self.addEventListener('message', async event => {
  const { id, buffer, mimeType } = event.data;
  try {
    const sourceIsPng = hasPngSignature(buffer);
    const result =
      sourceIsPng
        ? await compressPngBuffer(buffer)
        : await decodeBrowserImage(buffer, mimeType).then(decoded =>
            encodeFixedPng(
              decoded.rgbaBuffer,
              decoded.width,
              decoded.height,
              { sRGB: 0 }
            )
          );

    self.postMessage({ id, ok: true, ...result, sourceIsPng }, [result.buffer]);
  } catch (error) {
    const code = APPLICATION_ERROR_CODES.has(error?.code)
      ? error.code
      : 'ENCODE_ERROR';
    self.postMessage(failure(id, code, error?.message || 'PNG error'));
  }
});
