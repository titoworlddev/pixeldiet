import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  MIME_TO_EXTENSION,
  PNG_COMPRESSION_PROFILE,
  usesFixedPngProfile
} from '../utils';
import { fromBlob } from 'image-resize-compress';
import { compressPngInWorker } from './pngCompressionWorker';

const GENERIC_ERROR_NOTICE = 'No se pudo comprimir esta imagen.';

const withPngMetadata = image => ({
  ...image,
  type: 'image/png',
  src: image.src.replace(/^data:[^;,]+/, 'data:image/png')
});

const compressionSettings = (format, quality, profile) => ({
  compressedQuality: usesFixedPngProfile(format) ? null : Number(quality),
  compressionProfile:
    usesFixedPngProfile(format) && profile === PNG_COMPRESSION_PROFILE
      ? profile
      : null
});

const originalResult = (
  image,
  format,
  quality,
  notice = null,
  profile = null
) => ({
  compressedSrc: image.src,
  compressedSize: image.originalSize,
  compressedType: image.type,
  ...compressionSettings(format, quality, profile),
  compressionStatus: 'unchanged',
  compressionNotice: notice,
  compressionDetails: null
});

/**
 * Procesa y comprime imágenes con controles optimizados por formato
 * Sigue el principio de responsabilidad única (S en SOLID)
 */
export function useImageProcessor() {
  /**
   * Comprime una imagen según el formato y calidad especificados
   * @param {Object} image - Objeto de imagen con metadatos
   * @param {string} format - Formato de destino (MIME type)
   * @param {number} quality - Calidad de compresión (1-100)
   * @returns {Promise<Object>} Objeto con datos de la imagen comprimida
   */
  const compressImage = async (image, format, quality) => {
    try {
      console.log(
        `Comprimiendo imagen: ${image.name}, formato: ${format}, calidad: ${quality}%`
      );
      console.log(`Tamaño original: ${image.originalSize} bytes`);

      // Verificar si estamos cambiando de formato
      const changingFormat = image.type !== format;
      console.log(
        `Cambiando formato: ${changingFormat} (${image.type} -> ${format})`
      );

      // Para imágenes pequeñas sin cambio de formato, mantener original
      if (
        !changingFormat &&
        image.originalSize < 10000 &&
        !usesFixedPngProfile(format)
      ) {
        console.log('Imagen muy pequeña detectada - manteniendo original');
        return originalResult(image, format, quality);
      }

      // Convertir base64 a blob para procesar
      const blob = base64ToBlob(image.src, image.type);

      // Extraer el formato de salida del MIME type
      const outputFormat = format.split('/')[1];

      // Comprimir según el formato específico
      let compressedBlob;
      let compressionNotice = null;
      let compressionDetails = null;
      let compressionProfile = null;
      let sourceIsPng = null;

      switch (outputFormat) {
        case 'png': {
          const {
            blob: pngBlob,
            notice: pngNotice = null,
            profile,
            sourceIsPng: pngSourceIsPng,
            ...pngDetails
          } = await compressPNG(blob);
          compressedBlob = pngBlob;
          compressionNotice = pngNotice;
          compressionDetails = pngDetails;
          compressionProfile = profile;
          sourceIsPng = pngSourceIsPng;
          break;
        }
        case 'avif':
          compressedBlob = await compressAVIF(blob, quality);
          break;
        case 'webp':
          compressedBlob = await compressWebP(blob, quality);
          break;
        case 'jpeg':
          compressedBlob = await compressJPEG(blob, quality);
          break;
        case 'jxl':
          compressedBlob = await compressJXL(blob, quality);
          format = 'image/jxl';
          break;
        default:
          compressedBlob = await fromBlob(
            blob,
            quality,
            'auto',
            'auto',
            outputFormat
          );
      }

      console.log(`Tamaño comprimido: ${compressedBlob.size} bytes`);
      const reduction = (
        ((image.originalSize - compressedBlob.size) / image.originalSize) *
        100
      ).toFixed(2);
      console.log(`Reducción: ${reduction}%`);

      const sourceMatchesOutput = usesFixedPngProfile(format)
        ? sourceIsPng === true
        : !changingFormat;

      // Si la compresión no reduce el tamaño y no cambiamos formato, usar original
      if (compressedBlob.size >= image.originalSize && sourceMatchesOutput) {
        console.log('La compresión no redujo el tamaño. Manteniendo original.');
        return originalResult(
          usesFixedPngProfile(format) && sourceIsPng
            ? withPngMetadata(image)
            : image,
          format,
          quality,
          null,
          compressionProfile
        );
      }

      // Convertir blob a base64 para almacenar
      const base64Data = await blobToBase64(compressedBlob);

      console.log('Compresión completada exitosamente.');
      return {
        compressedSrc: base64Data,
        compressedSize: compressedBlob.size,
        compressedType: format,
        ...compressionSettings(format, quality, compressionProfile),
        compressionStatus: 'optimized',
        compressionNotice,
        compressionDetails
      };
    } catch (error) {
      console.error('Error en proceso de compresión:', error);

      // En caso de error, devolver la imagen original
      return originalResult(image, format, quality, GENERIC_ERROR_NOTICE);
    }
  };

  const compressWebP = async (blob, quality) => {
    return fromBlob(blob, quality, 'auto', 'auto', 'webp');
  };

  const compressJXL = async (blob, quality) => {
    return fromBlob(blob, quality, 'auto', 'auto', 'jxl');
  };
  const compressJPEG = async (blob, quality) => {
    return fromBlob(blob, quality, 'auto', 'auto', 'jpeg');
  };
  const compressAVIF = async (blob, quality) => {
    return fromBlob(blob, quality, 'auto', 'auto', 'avif');
  };

  const compressPNG = blob => compressPngInWorker(blob);

  /**
   * Convierte un Blob a una imagen
   * @param {Blob} blob - Blob a convertir
   * @returns {Promise<HTMLImageElement>} Elemento de imagen
   */
  const blobToImage = blob => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error('Error al cargar la imagen desde blob'));
      img.src = URL.createObjectURL(blob);
    });
  };

  /**
   * Convierte una imagen base64 a Blob
   * @param {string} base64 - Cadena base64
   * @param {string} mimeType - Tipo MIME de la imagen
   * @returns {Blob} Blob de imagen
   */
  const base64ToBlob = (base64, mimeType) => {
    const [header, data] = base64.split(',');
    const binaryString = atob(data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes.buffer], { type: mimeType });
  };

  /**
   * Convierte un Blob a base64
   * @param {Blob} blob - Blob a convertir
   * @returns {Promise<string>} Promesa con cadena base64
   */
  const blobToBase64 = blob => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () =>
        reject(new Error('Error al convertir blob a base64'));
      reader.readAsDataURL(blob);
    });
  };

  /**
   * Descarga una única imagen
   * @param {Object} image - Objeto de imagen con metadatos
   */
  const downloadSingleImage = image => {
    try {
      if (!image || !image.isCompressed) {
        throw new Error('La imagen no está comprimida');
      }

      const ext = MIME_TO_EXTENSION[image.compressedType] || '.png';
      const newName = image.name.slice(0, image.name.lastIndexOf('.'));
      const fileName = `${newName}${ext}`;

      const blob = base64ToBlob(image.compressedSrc, image.compressedType);
      saveAs(blob, fileName);
    } catch (error) {
      console.error('Error al descargar la imagen:', error);
      throw error;
    }
  };

  /**
   * Descarga todas las imágenes comprimidas en un archivo ZIP
   * @param {Array} images - Array de objetos de imagen
   */
  const downloadAllImages = async images => {
    try {
      const compressedImages = images.filter(img => img.isCompressed);

      if (compressedImages.length === 0) {
        throw new Error('No hay imágenes comprimidas para descargar');
      }

      if (compressedImages.length === 1) {
        downloadSingleImage(compressedImages[0]);
        return;
      }

      const zip = new JSZip();

      compressedImages.forEach(image => {
        const ext = MIME_TO_EXTENSION[image.compressedType] || '.png';
        const newName = image.name.slice(0, image.name.lastIndexOf('.'));
        const fileName = `${newName}${ext}`;

        const base64Data = image.compressedSrc.split(',')[1];
        zip.file(fileName, base64Data, { base64: true });
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });

      saveAs(zipBlob, 'pixeldiet_compressed.zip');
    } catch (error) {
      console.error('Error al descargar todas las imágenes:', error);
      throw error;
    }
  };

  return {
    compressImage,
    downloadSingleImage,
    downloadAllImages
  };
}
