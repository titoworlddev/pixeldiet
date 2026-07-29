import { PNG_COMPRESSION_PROFILE } from './constants';

export const COMPRESSION_QUALITY_LEVELS = [
  { label: 'Baja', value: 35 },
  { label: 'Media', value: 50 },
  { label: 'Alta', value: 75 }
];

export const usesFixedPngProfile = format => format === 'image/png';

export const shouldShowQualityControl = format =>
  !usesFixedPngProfile(format);

export const getBatchCompressionConcurrency = (format, modernPoolCapacity) => {
  if (usesFixedPngProfile(format)) return 1;
  if (format === 'image/avif' || format === 'image/jxl') {
    return modernPoolCapacity;
  }
  return 4;
};

export const getCompressionOutcome = result =>
  result?.compressionNotice ? 'failed' : result?.compressionStatus;

export const isCompressionCurrent = (image, format, quality) => {
  if (!image?.isCompressed || image.compressionNotice) return false;
  if (image.compressedType !== format) return false;
  return usesFixedPngProfile(format)
    ? image.compressionProfile === PNG_COMPRESSION_PROFILE
    : image.compressedQuality === Number(quality);
};
