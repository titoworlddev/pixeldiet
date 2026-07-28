/**
 * Constantes utilizadas en la aplicaciu00f3n
 */

/**
 * Opciones de formato de salida para la compresiu00f3n de imu00e1genes
 */
export const FORMAT_OPTIONS = [
  { name: 'PNG', value: 'image/png' },
  { name: 'JPEG', value: 'image/jpeg' },
  { name: 'WEBP', value: 'image/webp' },
  { name: 'AVIF', value: 'image/avif' }
];

/**
 * Correspondencia entre tipos MIME y extensiones de archivo
 */
export const MIME_TO_EXTENSION = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/jxl': '.jxl'
};

/**
 * Configuraciu00f3n por defecto para la compresiu00f3n
 */
export const DEFAULT_COMPRESSION_CONFIG = {
  quality: 75,
  format: 'image/png'
};

/**
 * Lu00edmite mu00e1ximo de imu00e1genes permitidas
 */
export const MAX_IMAGES = 40;

/**
 * Tamau00f1o mu00e1ximo de archivo permitido (en bytes)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const PNG_COMPRESSION_PROFILE = 'fixed-png-82-v1';
