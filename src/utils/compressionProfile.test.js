import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_QUALITY_LEVELS,
  getCompressionOutcome,
  isCompressionCurrent,
  shouldShowQualityControl,
  usesFixedPngProfile
} from './compressionProfile';

describe('compression profile policy', () => {
  it('defines the three supported lossy quality levels', () => {
    expect(COMPRESSION_QUALITY_LEVELS).toEqual([
      { label: 'Baja', value: 35 },
      { label: 'Media', value: 50 },
      { label: 'Alta', value: 75 }
    ]);
  });

  it('uses one fixed PNG profile and hides PNG quality', () => {
    expect(usesFixedPngProfile('image/png')).toBe(true);
    expect(shouldShowQualityControl('image/png')).toBe(false);
    expect(shouldShowQualityControl('image/webp')).toBe(true);
    expect(shouldShowQualityControl('image/jpeg')).toBe(true);
  });

  it('checks PNG cache by profile and other formats by quality', () => {
    expect(
      isCompressionCurrent(
        {
          isCompressed: true,
          compressedType: 'image/png',
          compressionProfile: 'fixed-png-82-v1',
          compressedQuality: null
        },
        'image/png',
        31
      )
    ).toBe(true);
    expect(
      isCompressionCurrent(
        {
          isCompressed: true,
          compressedType: 'image/webp',
          compressionProfile: null,
          compressedQuality: 75
        },
        'image/webp',
        75
      )
    ).toBe(true);
  });

  it('rejects incomplete, stale, and mismatched cached settings', () => {
    const currentPng = {
      isCompressed: true,
      compressedType: 'image/png',
      compressionProfile: 'fixed-png-82-v1',
      compressedQuality: null
    };

    expect(
      isCompressionCurrent({ ...currentPng, isCompressed: false }, 'image/png', 75)
    ).toBe(false);
    expect(
      isCompressionCurrent(
        { ...currentPng, compressedType: 'image/jpeg' },
        'image/png',
        75
      )
    ).toBe(false);
    expect(
      isCompressionCurrent(
        { ...currentPng, compressionProfile: undefined },
        'image/png',
        75
      )
    ).toBe(false);
    expect(
      isCompressionCurrent(
        { ...currentPng, compressionProfile: 'fixed-png-81-v1' },
        'image/png',
        75
      )
    ).toBe(false);
    expect(
      isCompressionCurrent(
        {
          isCompressed: true,
          compressedType: 'image/webp',
          compressedQuality: 74
        },
        'image/webp',
        75
      )
    ).toBe(false);
  });

  it('separates processing failures from ordinary unchanged results', () => {
    expect(
      getCompressionOutcome({
        compressionStatus: 'unchanged',
        compressionNotice: 'No se pudo comprimir esta imagen.'
      })
    ).toBe('failed');
    expect(
      getCompressionOutcome({
        compressionStatus: 'unchanged',
        compressionNotice: null
      })
    ).toBe('unchanged');
    expect(
      getCompressionOutcome({
        compressionStatus: 'optimized',
        compressionNotice: null
      })
    ).toBe('optimized');
  });
});
