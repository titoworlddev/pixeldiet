# Anu00e1lisis Funcional y Tu00e9cnico: Squish - Compresor de Imu00e1genes

## Anu00e1lisis Funcional

### Descripciu00f3n General
Squish es una aplicaciu00f3n web de una sola pu00e1gina que permite a los usuarios comprimir imu00e1genes de varios formatos, con opciones para ajustar la calidad de compresiu00f3n y elegir el formato de salida. La aplicaciu00f3n estu00e1 orientada a usuarios que necesitan optimizar imu00e1genes para su uso en sitios web o compartir a travu00e9s de medios digitales.

### Funcionalidades Principales

#### 1. Carga de Imu00e1genes
- Interfaz de arrastrar y soltar (drag & drop) para subir imu00e1genes
- Posibilidad de seleccionar imu00e1genes mediante el explorador de archivos
- Soporte para carga mu00faltiple de hasta 40 imu00e1genes simultu00e1neas
- Validaciu00f3n de tipo de archivo (solo imu00e1genes permitidas)
- Visualizaciu00f3n de miniaturas de las imu00e1genes cargadas

#### 2. Compresiu00f3n de Imu00e1genes
- Compresiu00f3n automu00e1tica al subir imu00e1genes
- Selecciu00f3n del formato de salida (PNG, JPEG, WEBP, AVIF, JXL)
- Ajuste de calidad de compresiu00f3n mediante deslizador (1-100%)
- Posibilidad de volver a comprimir las imu00e1genes con diferentes paru00e1metros
- Visualizaciu00f3n del tamau00f1o original vs. comprimido
- Cu00e1lculo del porcentaje de reducciu00f3n de tamau00f1o

#### 3. Descarga de Imu00e1genes
- Descarga individual de imu00e1genes comprimidas
- Descarga masiva de todas las imu00e1genes comprimidas en formato ZIP
- Comportamiento especial: si solo hay una imagen, se descarga directamente sin comprimir en ZIP
- Nombres de archivo consistentes y descriptivos

#### 4. Interfaz de Usuario
- Diseu00f1o limpio y moderno
- Responsive para adaptarse a diferentes dispositivos
- Indicadores visuales de progreso durante la carga y compresiu00f3n
- Tarjetas de imu00e1genes con informaciu00f3n de tamau00f1o y porcentaje de reducciu00f3n
- Totales agregados de compresiu00f3n para todas las imu00e1genes

## Anu00e1lisis Tu00e9cnico

### Arquitectura

La aplicaciu00f3n estu00e1 construida siguiendo los principios de arquitectura modular y de componentes, utilizando Vue.js como framework principal. La estructura del proyecto sigue las mejores pru00e1cticas para aplicaciones Vue, con una clara separaciu00f3n de responsabilidades.

### Tecnologu00edas Utilizadas

- **Framework Frontend**: Vue 3 con Composition API
- **Build System**: Vite
- **CSS Framework**: Tailwind CSS para estilos utilitarios
- **Componentes UI**: PrimeVue para componentes ricos de interfaz
- **Procesamiento de Imu00e1genes**: Canvas API del navegador para la compresiu00f3n de imu00e1genes
- **Generaciu00f3n de ZIP**: JSZip para la creaciu00f3n de archivos ZIP
- **Descarga de Archivos**: FileSaver.js para facilitar la descarga de archivos

### Componentes Principales

#### 1. ImageUploader
- Gestiona la interfaz de carga de imu00e1genes
- Valida tipos de archivo y lu00edmites
- Lee los archivos mediante FileReader API
- Emite eventos de carga completa con metadatos de imu00e1genes

#### 2. ImageList
- Muestra las imu00e1genes cargadas en una cuadru00edcula
- Proporciona controles para configurar la compresiu00f3n
- Inicia el proceso de compresiu00f3n para todas las imu00e1genes
- Gestiona las acciones de descarga

### Composables

#### useImageProcessor
- Encapsula la lu00f3gica de procesamiento de imu00e1genes
- Utiliza HTML Canvas para comprimir imu00e1genes
- Convierte entre formatos de imagen
- Gestiona la creaciu00f3n de archivos ZIP para descarga mu00faltiple

### Flujo de Datos

1. El usuario carga imu00e1genes a travu00e9s del componente ImageUploader
2. Las imu00e1genes se convierten a base64 y se almacenan en el estado de la aplicaciu00f3n
3. El componente ImageList recibe las imu00e1genes como props
4. El usuario configura los paru00e1metros de compresiu00f3n
5. Al iniciar la compresiu00f3n, se utiliza el composable useImageProcessor
6. Las imu00e1genes comprimidas se almacenan en el estado con metadatos actualizados
7. El usuario puede descargar imu00e1genes individuales o todas juntas

### Optimizaciones

- Uso de lazy loading para los componentes grandes
- Procesamiento asincru00f3nico de imu00e1genes para no bloquear la interfaz
- Generaciu00f3n de ZIP en segundo plano
- Reutilizaciu00f3n de componentes para mantener el tamau00f1o del bundle mu00ednimo
