import { PNG_COMPRESSION_PROFILE } from './constants';

export const COMPRESSION_QUALITY_LEVELS = [
  { label: 'Baja', value: 35 },
  { label: 'Media', value: 50 },
  { label: 'Alta', value: 75 }
];

export const usesFixedPngProfile = format => format === 'image/png';

export const shouldShowQualityControl = format =>
  !usesFixedPngProfile(format);

export const getCompressionOutcome = result =>
  result?.compressionNotice ? 'failed' : result?.compressionStatus;

export const isCompressionCurrent = (image, format, quality) => {
  if (!image?.isCompressed || image.compressedType !== format) return false;
  return usesFixedPngProfile(format)
    ? image.compressionProfile === PNG_COMPRESSION_PROFILE
    : image.compressedQuality === Number(quality);
};
