import JSZip from 'jszip';
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
    return new Promise((resolve, reject) => {
      try {
        console.log(`Comprimiendo imagen: ${image.name}, formato: ${format}, calidad: ${quality}%`);
        console.log(`Tamaño original: ${image.originalSize} bytes`);
        
        // Verificar si estamos cambiando de formato
        const changingFormat = image.type !== format;
        console.log(`Cambiando formato: ${changingFormat} (${image.type} -> ${format})`);
        
        // Para PNG pequeños sin cambio de formato, mantener original
        if (image.type === 'image/png' && !changingFormat && image.originalSize < 50000) {
          console.log('PNG pequeño detectado - manteniendo original para evitar aumento de tamaño');
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
          canvas.toBlob(blob => {
            if (!blob) {
              console.error('Error: No se pudo generar el blob');
              reject(new Error('Error al comprimir la imagen'));
              return;
            }
            
            console.log(`Tamaño comprimido: ${blob.size} bytes`);
            const reduction = ((image.originalSize - blob.size) / image.originalSize * 100).toFixed(2);
            console.log(`Reducción: ${reduction}%`);
            
            // Si la compresión aumenta el tamaño y no cambiamos formato, usar original
            if (blob.size > image.originalSize && !changingFormat) {
              console.log('La compresión aumentó el tamaño. Manteniendo original.');
              resolve({
                compressedSrc: image.src,
                compressedSize: image.originalSize,
                compressedType: image.type
              });
              return;
            }
            
            // Convertir blob a base64
            blobToBase64(blob).then(base64Data => {
              console.log('Compresión completada exitosamente.');
              resolve({
                compressedSrc: base64Data,
                compressedSize: blob.size,
                compressedType: format
              });
            }).catch(error => {
              console.error('Error al convertir blob a base64:', error);
              reject(error);
            });
          }, format, qualityValue);
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
        return Math.min(0.85, Math.max(0.65, qualityValue));
        
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
   * Convierte un Blob a base64
   * @param {Blob} blob - El blob a convertir
   * @returns {Promise<string>} - String base64
   */
  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Error al convertir blob a base64'));
      reader.readAsDataURL(blob);
    });
  };
  
  /**
   * Descarga una única imagen
   * @param {Object} image - Objeto de imagen con metadatos
   */
  const downloadSingleImage = (image) => {
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
   * Convierte una cadena base64 a Blob
   * @param {string} base64 - Cadena base64 con datos de la imagen
   * @param {string} mimeType - Tipo MIME de la imagen
   * @returns {Blob} - El blob resultante
   */
  const base64ToBlob = (base64, mimeType) => {
    // Extraer la parte de datos del base64
    const base64Data = base64.split(',')[1];
    const byteCharacters = atob(base64Data);
    const byteArrays = [];
    
    // Procesar en bloques para evitar problemas de memoria
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    
    return new Blob(byteArrays, { type: mimeType });
  };
  
  /**
   * Descarga todas las imágenes comprimidas en un archivo ZIP
   * @param {Array} images - Array de objetos de imagen
   */
  const downloadAllImages = async (images) => {
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
