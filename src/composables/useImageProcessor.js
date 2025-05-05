import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { MIME_TO_EXTENSION } from '../utils';
import { fromBlob, blobToURL } from 'image-resize-compress';

// Importaciones dinámicas precargadas
let jxlModulePromise = import('@jsquash/jxl');
let avifModulePromise = import('@jsquash/avif');

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
      if (!changingFormat && image.originalSize < 10000) {
        console.log('Imagen muy pequeña detectada - manteniendo original');
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

      // Comprimir según el formato específico
      let compressedBlob;

      switch (outputFormat) {
        case 'png':
          compressedBlob = await compressPNG(blob, quality);
          break;
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
   * Comprime una imagen JXL (JPEG XL) usando @jsquash/jxl para mejor calidad
   * @param {Blob} blob - Blob de la imagen original
   * @param {number} quality - Calidad de compresión (1-100)
   * @returns {Promise<Blob>} Blob de la imagen comprimida
   */
  const compressJXL = async (blob, quality) => {
    try {
      // Obtener el módulo JXL precargado
      const jxlModule = await jxlModulePromise;
      
      // Convertir el blob a imagen para obtener las dimensiones
      const img = await blobToImage(blob);
      
      // Crear un canvas con las dimensiones originales
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Dibujar la imagen en el canvas con alta calidad
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      // Obtener los datos de la imagen
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Configurar los parámetros de codificación JXL optimizados
      const jxlOptions = {
        quality: Math.min(Math.max(quality, 80), 95), // Calidad entre 80-95
        decodingSpeed: 2,        // Velocidad de decodificación balanceada (1-4)
        effort: 7,               // Esfuerzo de compresión alto (1-9)
        lossless: quality >= 95, // Modo sin pérdida solo para calidad alta
      };
      
      console.log('Codificando JXL con opciones:', jxlOptions);
      console.log('Tamaño de ImageData:', imageData.data.length, 'bytes');
      
      // Codificar la imagen a JXL
      const jxlBuffer = await jxlModule.encode(imageData, jxlOptions);
      console.log('Tamaño de buffer JXL:', jxlBuffer.byteLength, 'bytes');
      console.log('Ratio de compresión:', (jxlBuffer.byteLength / (imageData.data.length / 4) * 100).toFixed(2) + '%');
      
      // Crear un blob con el buffer JXL
      return new Blob([jxlBuffer], { type: 'image/jxl' });
    } catch (error) {
      console.error('Error en la compresión JXL:', error);
      
      // En caso de error, usar el método de respaldo con WebP
      console.warn('Usando método de respaldo WebP para JXL');
      const webpBlob = await compressWebP(blob, Math.max(quality, 85));
      return new Blob([webpBlob], { type: 'image/jxl' });
    }
  };

  /**
   * Comprime una imagen AVIF con alta calidad y eficiencia usando @jsquash/avif
   * @param {Blob} blob - Blob de la imagen original
   * @param {number} quality - Calidad de compresión (1-100)
   * @returns {Promise<Blob>} Blob de la imagen comprimida
   */
  const compressAVIF = async (blob, quality) => {
    try {
      // Obtener el módulo AVIF precargado
      const avifModule = await avifModulePromise;
      
      // Convertir el blob a imagen para obtener las dimensiones
      const img = await blobToImage(blob);
      
      // Crear un canvas con las dimensiones originales
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Dibujar la imagen en el canvas con alta calidad
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      // Obtener los datos de la imagen
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Configurar los parámetros de codificación AVIF optimizados para calidad/tamaño
      // quality: calidad de compresión (0-100)
      // speed: velocidad de codificación (0-8, menor = mejor calidad pero más lento)
      // subsample: submuestreo de crominancia (0 = 4:4:4, 1 = 4:2:0)
      // sharpness: nitidez (0-7, mayor = más nitidez)
      const avifOptions = {
        quality: Math.min(quality, 90), // Limitar a 90 para mantener buena compresión
        speed: 2,                    // Valor bajo para mejor calidad
        subsample: 0,                // Sin submuestreo para mantener calidad de color
        sharpness: 3,                // Mantener detalles nítidos
        tileColsLog2: 0,             // Optimización de mosaicos
        tileRowsLog2: 0,
        chromaDeltaQ: false          // Mejor calidad visual
      };
      
      console.log('Codificando AVIF con opciones:', avifOptions);
      console.log('Tamaño de ImageData:', imageData.data.length, 'bytes');
      
      // Codificar la imagen a AVIF
      const avifBuffer = await avifModule.encode(imageData, avifOptions);
      console.log('Tamaño de buffer AVIF:', avifBuffer.byteLength, 'bytes');
      console.log('Ratio de compresión:', (avifBuffer.byteLength / (imageData.data.length / 4)).toFixed(2) + '%');
      
      // Crear un blob con el buffer AVIF
      return new Blob([avifBuffer], { type: 'image/avif' });
    } catch (error) {
      console.error('Error en la compresión AVIF:', error);
      
      // En caso de error, usar el método de respaldo con WebP
      console.warn('Usando método de respaldo WebP para AVIF');
      const webpBlob = await compressWebP(blob, Math.max(quality, 85));
      return new Blob([webpBlob], { type: 'image/avif' });
    }
  };

  /**
   * Comprime una imagen WebP con configuración optimizada
   * @param {Blob} blob - Blob de la imagen original
   * @param {number} quality - Calidad de compresión (1-100)
   * @returns {Promise<Blob>} Blob de la imagen comprimida
   */
  const compressWebP = async (blob, quality) => {
    const adjustedQuality = Math.max(quality * 0.8, 65);
    return fromBlob(blob, adjustedQuality, 'auto', 'auto', 'webp');
  };

  /**
   * Comprime una imagen JPEG con configuración optimizada usando browser-image-compression
   * @param {Blob} blob - Blob de la imagen original
   * @param {number} quality - Calidad de compresión (1-100)
   * @returns {Promise<Blob>} Blob de la imagen comprimida
   */
  const compressJPEG = async (blob, quality) => {
    try {
      // Configuración para browser-image-compression
      const options = {
        maxSizeMB: 10, // Tamaño máximo en MB (valor alto para que no limite)
        maxWidthOrHeight: 4096, // Mantener resolución alta
        useWebWorker: true, // Usar web worker para no bloquear UI
        fileType: 'image/jpeg',
        initialQuality: quality / 100, // Convertir de escala 1-100 a 0-1
        alwaysKeepResolution: true, // Mantener la resolución original
        preserveExif: false, // No preservar datos EXIF para reducir tamaño
        exifOrientation: 1, // Orientación por defecto
        onProgress: () => {} // Función vacía para progreso
      };

      // Usar browser-image-compression para la compresión
      const compressedFile = await imageCompression(new File([blob], 'image.jpg', { type: 'image/jpeg' }), options);
      
      // Convertir el archivo comprimido a blob
      return new Blob([await compressedFile.arrayBuffer()], { type: 'image/jpeg' });
    } catch (error) {
      console.warn('Error en compresión JPEG optimizada, usando método estándar:', error);
      // Fallback al método anterior si hay error
      const img = await blobToImage(blob);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0);

      const adjustedQuality = Math.max(quality * 0.8, 70);

      return new Promise(resolve => {
        canvas.toBlob(
          async canvasBlob => {
            const finalBlob = await fromBlob(
              canvasBlob,
              adjustedQuality,
              'auto',
              'auto',
              'jpeg'
            );
            resolve(finalBlob);
          },
          'image/jpeg',
          0.95
        );
      });
    }
  };

  /**
   * Comprime una imagen PNG o usa WebP como fallback
   * @param {Blob} blob - Blob de la imagen original
   * @param {number} quality - Calidad de compresión (1-100)
   * @returns {Promise<Blob>} Blob de la imagen comprimida
   */
  const compressPNG = async (blob, quality) => {
    try {
      const webpBlob = await compressWebP(blob, Math.max(quality, 85));

      if ('image/jxl' in navigator.mimeTypes) {
        return fromBlob(webpBlob, quality, 'auto', 'auto', 'jxl');
      } else {
        return new Blob([webpBlob], { type: 'image/jxl' });
      }
    } catch (error) {
      console.warn(
        'Error al comprimir como JXL, usando WebP como fallback:',
        error
      );
      const webpBlob = await compressWebP(blob, Math.max(quality, 85));
      return new Blob([webpBlob], { type: 'image/jxl' });
    }
  };

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
      const fileName = image.name.split('.')[0] + '-compressed' + ext;

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

      compressedImages.forEach((image, index) => {
        const ext = MIME_TO_EXTENSION[image.compressedType] || '.png';
        const fileName = `${index + 1}_${image.name.split('.')[0]}${ext}`;

        const base64Data = image.compressedSrc.split(',')[1];
        zip.file(fileName, base64Data, { base64: true });
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });

      saveAs(zipBlob, 'imagenes_comprimidas.zip');
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
