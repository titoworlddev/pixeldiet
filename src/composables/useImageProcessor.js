import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { MIME_TO_EXTENSION } from '../utils';

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
          
          // Ajustar calidad según formato
          let qualityValue = quality / 100;
          
          // Ajustes de calidad según formato
          if (format === 'image/jpeg') {
            // Para JPEG, limitar calidad mínima
            qualityValue = Math.max(0.5, qualityValue);
          } else if (format === 'image/webp') {
            // Para WEBP, ajustar rango
            qualityValue = Math.min(0.9, qualityValue);
          } else if (format === 'image/png') {
            // PNG no usa parámetro de calidad
            qualityValue = undefined;
          }
          
          console.log(`Formato: ${format}, Calidad efectiva: ${qualityValue ?? 'N/A'}`);
          
          // Comprimir
          canvas.toBlob(blob => {
            if (!blob) {
              console.error('Error: No se pudo generar el blob');
              reject(new Error('Error al comprimir la imagen'));
              return;
            }
            
            console.log(`Tamaño comprimido: ${blob.size} bytes`);
            console.log(`Reducción: ${((image.originalSize - blob.size) / image.originalSize * 100).toFixed(2)}%`);
            
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
            const reader = new FileReader();
            reader.onload = e => {
              console.log('Compresión completada exitosamente.');
              resolve({
                compressedSrc: e.target.result,
                compressedSize: blob.size,
                compressedType: format
              });
            };
            
            reader.onerror = () => {
              console.error('Error al leer el blob');
              reject(new Error('Error al procesar la imagen comprimida'));
            };
            
            reader.readAsDataURL(blob);
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
   * Descarga una única imagen
   * @param {Object} image - Objeto de imagen con metadatos
   */
  const downloadSingleImage = (image) => {
    try {
      // Obtener la extensión de archivo según el tipo MIME
      const ext = MIME_TO_EXTENSION[image.compressedType] || '.png';
      const fileName = image.name.split('.')[0] + '-compressed' + ext;
      
      // Convertir base64 a blob para descargar
      const base64Data = image.compressedSrc.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteArrays = [];
      
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }
      
      const blob = new Blob(byteArrays, { type: image.compressedType });
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
  const downloadAllImages = async (images) => {
    try {
      // Si solo hay una imagen, descargarla directamente
      if (images.length === 1 && images[0].isCompressed) {
        downloadSingleImage(images[0]);
        return;
      }
      
      // Preparar el archivo ZIP
      const zip = new JSZip();
      const compressedImages = images.filter(img => img.isCompressed);
      
      if (compressedImages.length === 0) {
        console.warn('No hay imágenes comprimidas para descargar');
        throw new Error('No hay imágenes comprimidas para descargar');
      }
      
      // Agregar cada imagen al ZIP
      compressedImages.forEach((image, index) => {
        const ext = MIME_TO_EXTENSION[image.compressedType] || '.png';
        const fileName = image.name.split('.')[0] + '-compressed' + ext;
        
        // Obtener los datos binarios de la imagen comprimida
        const base64Data = image.compressedSrc.split(',')[1];
        zip.file(fileName, base64Data, { base64: true });
      });
      
      // Generar el archivo ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Descargar el archivo ZIP
      saveAs(zipBlob, 'compressed-images.zip');
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
