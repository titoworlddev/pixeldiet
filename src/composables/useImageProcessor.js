import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { MIME_TO_EXTENSION } from '../utils';
import { fromBlob, blobToURL } from 'image-resize-compress';

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
      console.log(`Comprimiendo imagen: ${image.name}, formato: ${format}, calidad: ${quality}%`);
      console.log(`Tamaño original: ${image.originalSize} bytes`);

      // Verificar si estamos cambiando de formato
      const changingFormat = image.type !== format;
      console.log(`Cambiando formato: ${changingFormat} (${image.type} -> ${format})`);

      // Para imágenes pequeñas sin cambio de formato, mantener original
      if (!changingFormat && image.originalSize < 30000) {
        console.log('Imagen pequeña detectada - manteniendo original para evitar aumento de tamaño');
        return {
          compressedSrc: image.src,
          compressedSize: image.originalSize,
          compressedType: image.type
        };
      }

      // Convertir base64 a blob para procesar
      const blob = base64ToBlob(image.src, image.type);
      
      // Extraer el formato de salida del MIME type
      const outputFormat = format.split('/')[1];
      
      // Ajustar la calidad según el formato
      let adjustedQuality = quality;
      if (outputFormat === 'avif') {
        // AVIF funciona mejor con valores de calidad más bajos
        adjustedQuality = Math.min(quality, 60); // Limitar a 60% máximo para AVIF
      } else if (outputFormat === 'webp') {
        // WebP funciona bien con valores moderados
        adjustedQuality = Math.min(quality, 80); // Limitar a 80% máximo para WebP
      }
      
      // Usar image-resize-compress para comprimir la imagen
      // Mantener dimensiones originales con 'auto'
      const compressedBlob = await fromBlob(blob, adjustedQuality, 'auto', 'auto', outputFormat);
      
      console.log(`Tamaño comprimido: ${compressedBlob.size} bytes`);
      const reduction = (((image.originalSize - compressedBlob.size) / image.originalSize) * 100).toFixed(2);
      console.log(`Reducción: ${reduction}%`);
      
      // Si la compresión aumenta el tamaño y no cambiamos formato, usar original
      if (compressedBlob.size > image.originalSize && !changingFormat) {
        console.log('La compresión aumentó el tamaño. Manteniendo original.');
        return {
          compressedSrc: image.src,
          compressedSize: image.originalSize,
          compressedType: image.type
        };
      }
      
      // Convertir blob a base64 para almacenar
      const base64Data = await blobToBase64(compressedBlob);
      
      console.log('Compresión completada exitosamente.');
      return {
        compressedSrc: base64Data,
        compressedSize: compressedBlob.size,
        compressedType: format
      };
    } catch (error) {
      console.error('Error en proceso de compresión:', error);
      
      // En caso de error, devolver la imagen original
      return {
        compressedSrc: image.src,
        compressedSize: image.originalSize,
        compressedType: image.type
      };
    }
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

      // Obtener la extensión de archivo según el tipo MIME
      const ext = MIME_TO_EXTENSION[image.compressedType] || '.png';
      const fileName = image.name.split('.')[0] + '-compressed' + ext;

      // Convertir base64 a blob para descargar
      const blob = base64ToBlob(image.compressedSrc, image.compressedType);
      saveAs(blob, fileName);
    } catch (error) {
      console.error('Error al descargar la imagen:', error);
      throw error; // Re-lanzar para manejarlo en el componente
    }
  };

  /**
   * Descarga todas las imágenes comprimidas en un archivo ZIP
   * @param {Array} images - Array de objetos de imagen
   */
  const downloadAllImages = async images => {
    try {
      // Filtrar solo imágenes comprimidas
      const compressedImages = images.filter(img => img.isCompressed);

      if (compressedImages.length === 0) {
        throw new Error('No hay imágenes comprimidas para descargar');
      }

      // Si solo hay una imagen, descargarla directamente
      if (compressedImages.length === 1) {
        downloadSingleImage(compressedImages[0]);
        return;
      }

      // Preparar el archivo ZIP
      const zip = new JSZip();

      // Agregar cada imagen al ZIP con su formato correcto
      compressedImages.forEach((image, index) => {
        const ext = MIME_TO_EXTENSION[image.compressedType] || '.png';
        const fileName = `${index + 1}_${image.name.split('.')[0]}${ext}`;

        // Obtener los datos binarios de la imagen comprimida
        const base64Data = image.compressedSrc.split(',')[1];
        zip.file(fileName, base64Data, { base64: true });
      });

      // Generar el archivo ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Descargar el archivo ZIP
      saveAs(zipBlob, 'imagenes_comprimidas.zip');
    } catch (error) {
      console.error('Error al descargar todas las imágenes:', error);
      throw error; // Re-lanzar para manejarlo en el componente
    }
  };

  return {
    compressImage,
    downloadSingleImage,
    downloadAllImages
  };
}
