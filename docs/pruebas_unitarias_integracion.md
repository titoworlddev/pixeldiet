# Plan de Pruebas: Squish - Compresor de Imu00e1genes

## Pruebas Unitarias

### 1. Componente ImageUploader

#### Tests de Validaciu00f3n
- Verificar que se rechacen archivos que no sean imu00e1genes
- Comprobar que se respete el lu00edmite de 40 imu00e1genes
- Validar que los archivos demasiado grandes sean rechazados

#### Tests de Procesamiento
- Verificar que las imu00e1genes se conviertan correctamente a base64
- Comprobar que los metadatos de imu00e1genes se generen correctamente
- Validar la emisiu00f3n del evento upload-complete con los datos correctos

#### Tests de UI
- Verificar la visualizaciu00f3n correcta del estado de carga
- Comprobar que el botu00f3n de limpiar elimine todas las imu00e1genes

### 2. Componente ImageList

#### Tests de Visualizaciu00f3n
- Verificar que las imu00e1genes se muestren correctamente en la cuadru00edcula
- Comprobar que la informaciu00f3n de tamau00f1o se muestre correctamente
- Validar que las imu00e1genes comprimidas se visualicen adecuadamente

#### Tests de Controles
- Verificar el funcionamiento del selector de formato
- Comprobar que el deslizador de calidad actualice el valor correctamente
- Validar el funcionamiento del botu00f3n de compresiu00f3n

#### Tests de Cu00e1lculos
- Verificar el cu00e1lculo correcto del tamau00f1o total original
- Comprobar el cu00e1lculo correcto del tamau00f1o total comprimido
- Validar el cu00e1lculo del porcentaje de reducciu00f3n

### 3. Composable useImageProcessor

#### Tests de Compresiu00f3n
- Verificar la compresiu00f3n de imu00e1genes PNG
- Comprobar la compresiu00f3n de imu00e1genes JPEG
- Validar la compresiu00f3n de imu00e1genes WEBP
- Verificar la compresiu00f3n de imu00e1genes AVIF

#### Tests de Conversiu00f3n
- Verificar la conversiu00f3n de PNG a JPEG
- Comprobar la conversiu00f3n de JPEG a WEBP
- Validar la conversiu00f3n de PNG a AVIF
- Verificar otras combinaciones de conversiu00f3n

#### Tests de Descarga
- Verificar la descarga individual de imu00e1genes
- Comprobar la generaciu00f3n correcta del archivo ZIP
- Validar que se use el mu00e9todo adecuado segu00fan el nu00famero de imu00e1genes

## Pruebas de Integraciu00f3n

### 1. Flujo de Carga y Compresiu00f3n
- Verificar el flujo completo desde la carga hasta la compresiu00f3n
- Comprobar la propagaciu00f3n correcta de eventos entre componentes
- Validar la actualizaciu00f3n del estado global de la aplicaciu00f3n

### 2. Flujo de Compresiu00f3n y Descarga
- Verificar el flujo desde la compresiu00f3n hasta la descarga individual
- Comprobar el flujo desde la compresiu00f3n hasta la descarga masiva
- Validar la funcionalidad especial para una sola imagen

### 3. Interacciu00f3n de Componentes
- Verificar la interacciu00f3n entre ImageUploader e ImageList
- Comprobar la comunicaciu00f3n bidireccional entre componentes
- Validar la actualizaciu00f3n sincronizada de la interfaz

## Pruebas End-to-End

### 1. Escenario: Usuario Comprime una Imagen
- Cargar una imagen PNG
- Cambiar el formato a WEBP
- Ajustar la calidad al 50%
- Comprimir la imagen
- Descargar la imagen comprimida
- Verificar el formato y tamau00f1o del archivo descargado

### 2. Escenario: Usuario Comprime Mu00faltiples Imu00e1genes
- Cargar 5 imu00e1genes de diferentes formatos
- Establecer el formato de salida a JPEG
- Comprimir todas las imu00e1genes
- Descargar todas las imu00e1genes
- Verificar el archivo ZIP y su contenido

### 3. Escenario: Usuario Cambia Configuraciu00f3n Varias Veces
- Cargar una imagen
- Comprimir con diferentes combinaciones de formato y calidad
- Verificar que cada compresiu00f3n actualice correctamente los datos
- Descargar la u00faltima versiu00f3n

## Pruebas de Rendimiento

### 1. Carga de Imu00e1genes
- Medir el tiempo de carga para 1, 10, 20 y 40 imu00e1genes
- Evaluar el uso de memoria durante la carga
- Verificar la responsividad de la interfaz durante la carga

### 2. Compresiu00f3n de Imu00e1genes
- Medir el tiempo de compresiu00f3n para diferentes formatos y tamau00f1os
- Evaluar el uso de CPU durante la compresiu00f3n
- Verificar el rendimiento en diferentes dispositivos

### 3. Generaciu00f3n de ZIP
- Medir el tiempo de generaciu00f3n para diferentes cantidades de imu00e1genes
- Evaluar el uso de memoria durante la generaciu00f3n
- Verificar el rendimiento con imu00e1genes de gran tamau00f1o

## Pruebas de Compatibilidad

### 1. Navegadores
- Verificar funcionalidad en Chrome
- Comprobar funcionalidad en Firefox
- Validar funcionalidad en Safari
- Verificar funcionalidad en Edge

### 2. Dispositivos
- Verificar funcionalidad en desktop
- Comprobar funcionalidad en tablets
- Validar funcionalidad en smartphones

### 3. Sistemas Operativos
- Verificar funcionalidad en Windows
- Comprobar funcionalidad en macOS
- Validar funcionalidad en Android
- Verificar funcionalidad en iOS
