import JSZip from 'jszip';
import imageCompression from 'browser-image-compression';
import { saveAs } from 'file-saver';
import { MIME_TO_EXTENSION } from '../utils';

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
  const compressImage = (image, format, quality) => {
    // Para PNG, usar browser-image-compression para mejor reducción
    if (format === 'image/png') {
      const originalBlob = base64ToBlob(image.src, image.type);
      const options = {
        fileType: 'image/png',
        useWebWorker: true,
        maxSizeMB: (image.originalSize / 1024 / 1024) * 0.5
      };
      return imageCompression(originalBlob, options)
        .then(blob => {
          if (!blob || blob.size === 0) throw new Error('Error al comprimir PNG');
          if (blob.size > image.originalSize) {
            return {
              compressedSrc: image.src,
              compressedSize: image.originalSize,
              compressedType: image.type
            };
          }
          return blobToBase64(blob).then(base64 => ({
            compressedSrc: base64,
            compressedSize: blob.size,
            compressedType: 'image/png'
          }));
        });
    }
    // Para AVIF con compresión optimizada
    if (format === 'image/avif') {
      return new Promise(async (resolve, reject) => {
        try {
          console.log(`Comprimiendo AVIF con método optimizado: ${quality}%`);
          
          // Crear un canvas temporal para preprocesar la imagen
          const tempCanvas = document.createElement('canvas');
          const img = new Image();
          img.src = image.src;
          await new Promise(resolve => { img.onload = resolve; });
          
          // Calcular dimensiones optimizadas (múltiplos de 16 para mejor compresión AVIF)
          const width = Math.floor(img.width / 16) * 16;
          const height = Math.floor(img.height / 16) * 16;
          
          tempCanvas.width = width;
          tempCanvas.height = height;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          
          // Aplicar preprocesamiento para mejorar la compresión
          tempCtx.imageSmoothingEnabled = true;
          tempCtx.imageSmoothingQuality = 'high';
          tempCtx.drawImage(img, 0, 0, width, height);
          
          // Crear el canvas final para la compresión
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
          
          // Aplicar filtros para mejorar la compresión
          // Reducir ruido y detalles finos que son difíciles de comprimir
          const imageData = tempCtx.getImageData(0, 0, width, height);
          const data = imageData.data;
          
          // Aplicar filtro más agresivo para maximizar compresión
          {
            // Forzar un valor de strength alto para compresión extrema
            const strength = 4; // Valor fijo para máxima compresión
            for (let i = 0; i < data.length; i += 4) {
              // Suavizar colores para mejor compresión
              data[i] = Math.round(data[i] / strength) * strength;     // R
              data[i+1] = Math.round(data[i+1] / strength) * strength; // G
              data[i+2] = Math.round(data[i+2] / strength) * strength; // B
              
              // Reducir información de color para mejorar compresión
              if (i % 8 === 0) { // Aplicar a 1 de cada 8 píxeles para mantener algo de detalle
                // Reducir la profundidad de color
                data[i] = Math.floor(data[i] / 16) * 16;     // Reducir a 16 niveles (R)
                data[i+1] = Math.floor(data[i+1] / 16) * 16; // Reducir a 16 niveles (G)
                data[i+2] = Math.floor(data[i+2] / 16) * 16; // Reducir a 16 niveles (B)
              }
            }
          }
          
          ctx.putImageData(imageData, 0, 0);
          
          // Calcular calidad AVIF optimizada
          // Usar una curva no lineal para la calidad
          // Valores bajos de calidad son más agresivos en AVIF
          let avifQuality;
          // Usar valores extremadamente bajos para máxima compresión
          // Esto es más agresivo que la escala anterior
          if (quality >= 90) {
            avifQuality = 0.3;    // Antes 0.9
          } else if (quality >= 80) {
            avifQuality = 0.25;   // Antes 0.8
          } else if (quality >= 70) {
            avifQuality = 0.2;    // Antes 0.65
          } else if (quality >= 60) {
            avifQuality = 0.15;   // Antes 0.5
          } else if (quality >= 50) {
            avifQuality = 0.1;    // Antes 0.35
          } else if (quality >= 40) {
            avifQuality = 0.08;   // Antes 0.25
          } else if (quality >= 30) {
            avifQuality = 0.05;   // Antes 0.15
          } else {
            avifQuality = 0.03;   // Antes 0.1
          }
          
          // Comprimir a AVIF con calidad optimizada
          canvas.toBlob(blob => {
            if (!blob) {
              console.error('No se pudo generar el blob AVIF');
              resolve({ compressedSrc: image.src, compressedSize: image.originalSize, compressedType: image.type });
              return;
            }
            
            console.log(`AVIF original: ${image.originalSize} bytes, comprimido: ${blob.size} bytes`);
            const reduction = (((image.originalSize - blob.size) / image.originalSize) * 100).toFixed(2);
            console.log(`Reducción AVIF: ${reduction}%`);
            
            // Si la compresión no mejora y no estamos cambiando formato, mantener original
            if (blob.size >= image.originalSize && image.type === 'image/avif') {
              resolve({ compressedSrc: image.src, compressedSize: image.originalSize, compressedType: image.type });
              return;
            }
            
            // Convertir a base64 y devolver
            blobToBase64(blob).then(base64 => {
              resolve({ compressedSrc: base64, compressedSize: blob.size, compressedType: 'image/avif' });
            }).catch(error => {
              console.error('Error al convertir blob a base64:', error);
              reject(error);
            });
          }, 'image/avif', avifQuality);
        } catch (err) {
          console.error('Error en compresión AVIF:', err);
          reject(err);
        }
      });
    }
    return new Promise((resolve, reject) => {
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

        // Para PNG pequeños sin cambio de formato, mantener original
        if (
          image.type === 'image/png' &&
          !changingFormat &&
          image.originalSize < 50000
        ) {
          console.log(
            'PNG pequeño detectado - manteniendo original para evitar aumento de tamaño'
          );
          resolve({
            compressedSrc: image.src,
            compressedSize: image.originalSize,
            compressedType: image.type
          });
          return;
        }

        const canvas = document.createElement('canvas');
        const img = new Image();

        img.onload = () => {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          // Usar dimensiones originales
          canvas.width = img.width;
          canvas.height = img.height;
          console.log(`Dimensiones: ${canvas.width}x${canvas.height}`);

          // Preparar canvas según formato
          if (format === 'image/png') {
            // Para PNG, limpiar canvas para mantener transparencia
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          } else if (format === 'image/jpeg') {
            // Para JPEG, fondo blanco
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          // Dibujar la imagen
          ctx.drawImage(img, 0, 0);

          // Optimizar calidad según formato
          let qualityValue = qualityForFormat(format, quality);

          // Comprimir
          canvas.toBlob(
            blob => {
              if (!blob) {
                console.error('Error: No se pudo generar el blob');
                reject(new Error('Error al comprimir la imagen'));
                return;
              }

              console.log(`Tamaño comprimido: ${blob.size} bytes`);
              const reduction = (
                ((image.originalSize - blob.size) / image.originalSize) *
                100
              ).toFixed(2);
              console.log(`Reducción: ${reduction}%`);

              // Si la compresión aumenta el tamaño y no cambiamos formato, usar original
              if (blob.size > image.originalSize && !changingFormat) {
                console.log(
                  'La compresión aumentó el tamaño. Manteniendo original.'
                );
                resolve({
                  compressedSrc: image.src,
                  compressedSize: image.originalSize,
                  compressedType: image.type
                });
                return;
              }

              // Convertir blob a base64
              blobToBase64(blob)
                .then(base64Data => {
                  console.log('Compresión completada exitosamente.');
                  resolve({
                    compressedSrc: base64Data,
                    compressedSize: blob.size,
                    compressedType: format
                  });
                })
                .catch(error => {
                  console.error('Error al convertir blob a base64:', error);
                  reject(error);
                });
            },
            format,
            qualityValue
          );
        };

        img.onerror = () => {
          console.error('Error al cargar la imagen');
          reject(new Error('Error al cargar la imagen para compresión'));
        };

        // Cargar imagen desde src
        img.src = image.src;
      } catch (error) {
        console.error('Error en proceso de compresión:', error);
        reject(error);
      }
    });
  };

  /**
   * Determina el valor de calidad óptimo para cada formato
   * @param {string} format - Formato MIME de la imagen
   * @param {number} quality - Valor base de calidad (0-100)
   * @returns {number|undefined} - Valor de calidad adaptado o undefined para formatos sin compresión
   */
  const qualityForFormat = (format, quality) => {
    // Convertir calidad a escala 0-1 para canvas
    let qualityValue = quality / 100;

    // Ajustes de calidad según formato
    switch (format) {
      case 'image/jpeg':
        // JPEG - limitar calidad mínima para evitar artefactos
        return Math.max(0.6, qualityValue);

      case 'image/webp':
        // WebP - ajustar rango y asegurar buena calidad
        return Math.min(0.92, Math.max(0.7, qualityValue));

      case 'image/avif':
        // AVIF - necesita una calidad moderada-alta
        return Math.min(0.95, Math.max(0.65, qualityValue));

      case 'image/jxl':
        // JXL - calidad alta para este formato avanzado
        return Math.min(0.9, Math.max(0.75, qualityValue));

      case 'image/png':
        // PNG no usa parámetro de calidad
        return undefined;

      default:
        return qualityValue;
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
