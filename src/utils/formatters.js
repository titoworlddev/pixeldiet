/**
 * Utilidades para formateo de datos en la aplicación
 */

/**
 * Formatea un tamaño en bytes a una unidad legible para humanos (KB, MB, GB)
 * @param {number} bytes - El tamaño en bytes
 * @param {number} decimals - Número de decimales a mostrar
 * @returns {string} - Cadena formateada con unidad
 */
export const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Calcula el porcentaje de reducción entre dos tamaños
 * @param {number} originalSize - Tamaño original
 * @param {number} compressedSize - Tamaño comprimido
 * @returns {number} - Porcentaje de reducción
 */
export const calculateReduction = (originalSize, compressedSize) => {
  if (originalSize === 0 || compressedSize === 0) return 0;
  return Math.round(((originalSize - compressedSize) / originalSize) * 100);
};
