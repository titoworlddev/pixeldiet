# Compresion PNG con perfil fijo

Este documento sustituye el diseno adaptativo del 27 de julio de 2026 y su
plan de implementacion. La politica PSNR y el selector de calidad PNG quedan
descartados.

## Contexto

La ruta PNG adaptativa actual usa UPNG sin tramado y eleva la paleta hasta
alcanzar un umbral PSNR. En la imagen de referencia esto obliga a usar 512
colores. Como un PNG indexado solo admite 256, el resultado pasa a RGB y pierde
gran parte del ahorro esperado.

Resultados medidos con `test_images/Original.png`:

| Variante | Tamano | Reduccion | Colores |
| --- | ---: | ---: | ---: |
| Original | 621.968 bytes | 0 % | 124.674 |
| PixelDiet actual al 30 % | 211.234 bytes | 66,04 % | 512 |
| imgto.xyz (`q_auto:low`) | 108.855 bytes | 82,50 % | 82 |
| Prototipo local aprobado | 105.842 bytes | 82,98 % | 82 |

`imgto.xyz` procesa las imagenes en Cloudinary. PixelDiet mantendra su requisito
de procesar todo localmente y reproducira el enfoque visual del resultado, no el
servicio ni el algoritmo propietario de Cloudinary.

## Decision

PNG tendra un unico perfil de compresion sin selector de calidad. El perfil
usara:

- `image-q` con licencia MIT para generar una paleta mediante WuQuant.
- La distancia de color PNGQuant.
- Un maximo de 82 colores.
- Tramado Floyd-Steinberg para disimular bandas en degradados y fotografias.
- UPNG para decodificar y codificar el PNG final.
- Un Web Worker para que la cuantizacion no bloquee la interfaz.

No se usara `libimagequant-wasm` porque el codigo nativo que envuelve requiere
cumplir GPLv3 o adquirir una licencia comercial.

## Alcance

La modificacion afecta exclusivamente a la ruta de salida PNG y a la visibilidad
del selector de calidad.

Las rutas JPEG/JPG, WebP, AVIF y JXL conservaran sus funciones, argumentos,
valores de calidad y comportamiento actuales. Se anadiran pruebas de regresion
para impedir cambios accidentales en JPEG/JPG y WebP.

## Interfaz

- Al seleccionar PNG se ocultara por completo el bloque de calidad.
- No se mostrara texto explicativo en sustitucion del control.
- Al seleccionar otro formato, la barra reaparecera con el ultimo valor elegido.
- PNG no dependera del valor oculto de la barra ni se reprocesara si ese valor
  cambia mientras se usa otro formato.
- Cada resultado mostrara solo tamano original, tamano final, reduccion y estado.
- Si el original es menor, el estado sera `Sin cambios`, sin detalles tecnicos.
- Los errores visibles usaran mensajes genericos y conservaran el original.

## Flujo De Datos

### PNG de entrada

1. El cliente transfiere al worker los bytes originales.
2. UPNG valida y decodifica el archivo directamente a RGBA de 8 bits.
3. Se conservan dimensiones y el perfil de color ICC o la declaracion sRGB.
4. Se descartan EXIF, XMP y otros metadatos que no afectan a la representacion.
5. Si la imagen contiene 82 colores RGBA o menos, se evita la cuantizacion para
   conservar los pixeles exactamente.
6. Si contiene mas colores, `image-q` genera una paleta WuQuant de hasta 82
   colores y aplica Floyd-Steinberg.
7. UPNG codifica la representacion como PNG indexado y reincorpora solo la
   informacion de color necesaria.
8. Si la salida no es menor que el PNG de entrada, se conserva el original.

### Conversion a PNG

Para entradas JPEG, WebP, AVIF o JXL que se conviertan a PNG, el worker seguira
usando las APIs de imagen del navegador para obtener RGBA. Despues aplicara el
mismo perfil fijo. Como el usuario ha solicitado un cambio de formato, se
devolvera un PNG valido aunque sea mayor que el archivo de entrada.

## Transparencia Y Color

- Los PNG con 82 colores RGBA visibles o menos conservaran exactamente el alfa
  y el RGB de los pixeles visibles.
- En imagenes cuantizadas, el alfa participara en la seleccion de paleta y se
  mantendra la presencia de transparencia sin introducir un fondo opaco.
- Los valores RGB ocultos tras alfa cero no se consideran informacion visual.
- El perfil ICC de una entrada PNG se conservara para evitar cambios de color al
  visualizar el resultado en aplicaciones con gestion de color.

## Contrato Del Procesamiento

La solicitud PNG dejara de recibir una calidad numerica. El resultado incluira
un identificador interno de perfil fijo para que la aplicacion pueda reconocer
que un PNG ya fue procesado sin compararlo con la calidad usada por otros
formatos.

El limite existente de 20 megapixeles, el procesamiento secuencial de lotes y la
reutilizacion del worker se mantendran.

## Errores

- Una imagen invalida, un limite excedido o un fallo de codificacion no producira
  una descarga parcial.
- El original seguira disponible y el resto del lote continuara procesandose.
- Un fallo fatal reiniciara el worker para la siguiente imagen.
- La interfaz no expondra nombres de codecs, workers, librerias ni decisiones
  internas.

## Pruebas

### Compresion PNG

- El archivo `test_images/Original.png` produce un PNG de 110.000 bytes o menos.
- La reduccion del archivo de referencia es como minimo del 82 %.
- La salida es un PNG indexado valido de 488 por 732 pixeles y usa como maximo 82
  colores.
- La salida conserva el mismo perfil ICC que el original.
- La salida no contiene EXIF ni XMP.
- Un PNG de 82 colores RGBA visibles o menos conserva exactamente el alfa y el
  RGB de los pixeles visibles; el RGB oculto tras alfa cero puede normalizarse.
- Una imagen con transparencia mantiene transparencia despues de cuantizarse.
- Una salida mayor no sustituye a un PNG original menor.
- No se realizan peticiones de red con los bytes de la imagen.

### Interfaz

- El selector de calidad no existe en el DOM mientras PNG esta seleccionado.
- El selector reaparece con su valor anterior al elegir otro formato.
- Repetir una compresion PNG con el perfil fijo no depende de la calidad de otro
  formato.
- No aparece ayuda tecnica especifica de PNG.

### Regresiones

- JPEG/JPG sigue invocando `fromBlob` con la calidad seleccionada y `jpeg`.
- WebP sigue invocando `fromBlob` con la calidad seleccionada y `webp`.
- Los bytes, MIME y nombres descargados de JPEG/JPG y WebP siguen siendo
  coherentes con el formato solicitado.
- La suite completa y la compilacion de produccion deben finalizar sin errores.

## Criterios De Aceptacion

1. PNG no muestra ni consume un valor de calidad configurable.
2. `test_images/Original.png` queda en 110.000 bytes o menos y reduce al menos un
   82 %.
3. El resultado visual coincide con el prototipo local aprobado.
4. Dimensiones, transparencia y gestion de color se mantienen.
5. El resultado siempre contiene bytes PNG validos.
6. JPEG/JPG y WebP no cambian de comportamiento.
7. Todo el procesamiento ocurre localmente y fuera del hilo principal.
8. La interfaz no expone detalles internos del procesamiento.

## Fuera De Alcance

- Garantizar el mismo porcentaje de reduccion para todos los PNG.
- Igualar exactamente el algoritmo propietario de Cloudinary.
- Cambiar automaticamente PNG por WebP u otro formato.
- Redimensionar, recortar o eliminar fondos.
- Modificar los algoritmos actuales de JPEG/JPG, WebP, AVIF o JXL.
