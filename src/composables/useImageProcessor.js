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
        const canvas = document.createElement('canvas');
        const img = new Image();
        
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Dibujar la imagen en el canvas
          ctx.drawImage(img, 0, 0);
          
          // Convertir la calidad a un valor entre 0 y 1
          const normalizedQuality = quality / 100;
          
          // Comprimir la imagen al formato deseado
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Error al generar el blob de la imagen'));
              return;
            }
            
            // Convertir el blob a base64 para visualización
            const reader = new FileReader();
            reader.onload = (e) => {
              resolve({
                compressedSrc: e.target.result,
                compressedSize: blob.size,
                blob
              });
            };
            
            reader.readAsDataURL(blob);
          }, format, normalizedQuality);
        };
        
        img.onerror = () => {
          reject(new Error('Error al cargar la imagen'));
        };
        
        // Cargar la imagen desde el src existente
        img.src = image.src;
      } catch (error) {
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
        const fileName = `imagen_${index + 1}${ext}`;
        
        // Extraer datos de base64
        const base64Data = image.compressedSrc.split(',')[1];
        zip.file(fileName, base64Data, { base64: true });
      });
      
      // Generar el archivo ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
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
