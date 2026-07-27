import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageProcessor } from './useImageProcessor';

const { saveAsMock } = vi.hoisted(() => ({ saveAsMock: vi.fn() }));

vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

vi.mock('image-resize-compress', () => ({
  fromBlob: vi.fn(async (_blob, _quality, _width, _height, format) => {
    if (format === 'png') {
      return new Blob(
        [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        { type: 'image/png' }
      );
    }

    return new Blob([new TextEncoder().encode('RIFF0000WEBP')], {
      type: `image/${format}`
    });
  })
}));

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
  beforeAll(() => {
    vi.stubGlobal('FileReader', TestFileReader);
  });

  beforeEach(() => {
    saveAsMock.mockClear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('descarga bytes PNG reales al convertir una imagen a PNG', async () => {
    const sourceBytes = new Uint8Array(20001);
    sourceBytes.set([0xff, 0xd8, 0xff]);

    const image = {
      name: 'original.jpg',
      originalSize: sourceBytes.byteLength,
      type: 'image/jpeg',
      src: `data:image/jpeg;base64,${Buffer.from(sourceBytes).toString('base64')}`
    };

    const { compressImage, downloadSingleImage } = useImageProcessor();
    const result = await compressImage(image, 'image/png', 75);
    downloadSingleImage({ ...image, ...result, isCompressed: true });

    const [downloadedBlob, fileName] = saveAsMock.mock.calls[0];
    const outputBytes = new Uint8Array(await downloadedBlob.arrayBuffer());

    expect(result.compressedType).toBe('image/png');
    expect(downloadedBlob.type).toBe('image/png');
    expect(fileName).toBe('original.png');
    expect([...outputBytes.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
  });
});
