# Compresión PNG adaptativa en el navegador

> Sustituido por
> `docs/superpowers/specs/2026-07-28-fixed-png-compression-design.md`. No usar
> este documento para nuevas modificaciones.

## Contexto

La ruta PNG actual genera un archivo válido, pero usa la codificación PNG nativa del navegador. Esta codificación es sin pérdida, ignora el porcentaje de calidad y puede producir un archivo mayor que el original. En ese caso, PixelDiet conserva correctamente el original y muestra una reducción del 0 %.

La reproducción realizada con `pixeldiet-source.png` dio estos resultados:

| Método | Tamaño | Reducción | Fidelidad |
| --- | ---: | ---: | ---: |
| Original | 199.812 bytes | 0 % | Exacta |
| Codificador actual | 246.521 bytes | -23,38 % | Exacta |
| UPNG sin pérdida | 164.739 bytes | 17,55 % | Exacta |
| UPNG con 256 colores | ~66.100 bytes | ~66,9 % | ~52,8 dB PSNR |
| UPNG con 128 colores | ~54.100 bytes | ~72,9 % | ~50,5 dB PSNR |

Cloudinary consigue reducciones similares mediante análisis de contenido y selección automática de calidad en sus servidores. Su algoritmo `q_auto` es propietario. PixelDiet replicará el principio de optimización adaptativa, no su implementación exacta.

## Objetivos

- Procesar cada imagen íntegramente en el navegador.
- No subir imágenes ni realizar peticiones de red durante la compresión.
- Generar siempre bytes PNG válidos cuando el formato de salida sea PNG.
- Mantener dimensiones y el canal alfa; en calidad 100, conservar sus valores exactamente.
- Conseguir reducciones grandes con una pérdida visual mínima y medida.
- Mantener la interfaz receptiva durante la compresión de lotes.
- Conservar el original cuando ninguna variante válida sea menor.

## Fuera de alcance

- Replicar exactamente el algoritmo propietario de Cloudinary.
- Garantizar el mismo porcentaje de reducción para todas las imágenes.
- Redimensionar, recortar o eliminar fondos.
- Añadir un servicio, API o almacenamiento remoto.
- Añadir OxiPNG en esta iteración.

## Solución elegida

Se usará `@upng/upng-js` para cuantización de color y codificación PNG. La dependencia es MIT, funciona localmente y conserva el canal alfa. El trabajo pesado se ejecutará en un Web Worker reutilizable.

La cuantización de UPNG calcula una paleta a partir del contenido real de la imagen. PixelDiet añadirá una política de calidad y una comprobación de fidelidad para impedir que una paleta demasiado pequeña degrade la imagen.

## Arquitectura

### Cliente del worker

El composable mantendrá un único cliente de compresión PNG durante la vida de la aplicación. Cada petición tendrá un identificador y transferirá los `ArrayBuffer` de entrada y salida sin copiarlos. El worker reconstruirá el `Blob` de entrada a partir de sus bytes y MIME.

Responsabilidades:

- Crear el worker bajo demanda.
- Asociar respuestas con peticiones pendientes.
- Reiniciar el worker si ocurre un error no recuperable.
- Rechazar las peticiones pendientes si el worker falla.

### Worker PNG

El worker será un módulo separado generado por Vite. Sus responsabilidades serán:

1. Decodificar el `Blob` con `createImageBitmap`.
2. Validar dimensiones y número total de píxeles.
3. Dibujar en `OffscreenCanvas` y obtener RGBA de 8 bits.
4. Elegir la política inicial según la calidad solicitada.
5. Cuantizar los colores con UPNG.
6. Medir la fidelidad de los píxeles visibles.
7. Aumentar la paleta si la fidelidad no alcanza el mínimo.
8. Codificar la variante aprobada como PNG.
9. Devolver bytes, tamaño, paleta utilizada y fidelidad medida.

El paquete elegido contiene una comprobación histórica de `window.UZIP` para buffers grandes. El worker cargará UPNG después de instalar un alias compatible sobre `globalThis`, y una prueba cubrirá imágenes RGBA mayores de 10 MB.

Si el navegador no admite `createImageBitmap`, `OffscreenCanvas` o módulos en workers, PixelDiet usará el codificador PNG nativo actual como fallback. El fallback seguirá produciendo un PNG válido, aunque puede no reducir el tamaño.

## Política de calidad

| Calidad solicitada | Paleta inicial | PSNR mínimo |
| ---: | ---: | ---: |
| 100 | Todos los colores | Píxeles exactos |
| 95-99 | 1024 colores | 58 dB |
| 85-94 | 512 colores | 55 dB |
| 70-84 | 256 colores | 52 dB |
| 55-69 | 128 colores | 49 dB |
| 40-54 | 64 colores | 46 dB |
| 30-39 | 32 colores | 43 dB |

Para calidades menores de 100:

1. Se cuantiza con la paleta inicial.
2. Se calcula PSNR usando RGB premultiplicado por alfa y el propio canal alfa. Los colores ocultos de píxeles totalmente transparentes no penalizan la métrica.
3. Si no se alcanza el umbral, se duplica la paleta y se repite.
4. La búsqueda termina al aprobar una variante o al llegar a 4096 colores.
5. Si ninguna variante aprueba, se usa codificación sin pérdida.

Calidad 100 significa igualdad con el RGBA de 8 bits decodificado por el navegador, no igualdad binaria con el archivo de entrada. Se pueden eliminar metadatos y cambiar la estructura interna del PNG sin alterar esa representación visual.

## Selección del resultado

- Para PNG a PNG, si el resultado optimizado no es menor, se conserva el archivo original.
- Para una conversión desde otro formato, se devuelve el PNG válido aunque sea mayor, porque el usuario solicitó cambiar el formato.
- Se preservan ancho, alto y presencia del canal alfa. Por debajo de calidad 100, cualquier variación de color o alfa debe respetar el umbral PSNR.
- Se eliminan metadatos prescindibles para reducir tamaño y evitar conservar datos privados.
- La extensión y el MIME siempre se derivan del formato realmente codificado.

## Memoria y rendimiento

- La optimización adaptativa admite hasta 20 megapíxeles por imagen.
- Las imágenes se procesan secuencialmente, como en el flujo actual.
- Los buffers se transfieren entre hilos en vez de clonarse.
- El worker se reutiliza durante el lote para evitar inicializar el codificador hasta 40 veces.
- El objetivo para una imagen de aproximadamente 2 megapíxeles es completar la cuantización en menos de 1 segundo en un equipo de escritorio moderno, sin tareas largas de cuantización en el hilo principal.

Una imagen mayor de 20 megapíxeles se conserva sin optimización adaptativa y genera un aviso visible. Este límite evita que varias copias RGBA agoten la memoria del navegador, especialmente en dispositivos móviles.

## Errores

El worker devolverá errores estructurados para imagen inválida, límite de píxeles, navegador incompatible y fallo de codificación.

- Nunca se descargará una salida parcial.
- El original permanecerá disponible.
- Un fallo en una imagen no detendrá el resto del lote.
- La interfaz distinguirá imágenes optimizadas de imágenes conservadas por un aviso.
- Un error fatal reiniciará el worker antes de la siguiente imagen.

## Interfaz

El control existente seguirá representando calidad visual.

- Para PNG se mostrará una ayuda breve: `100 % conserva todos los píxeles; valores menores reducen colores de forma inteligente`.
- Cada resultado guardará la calidad utilizada. Cambiar el porcentaje invalidará el resultado anterior y permitirá volver a comprimir en el mismo formato.
- La reducción seguirá calculándose con el tamaño final elegido.
- Si se conserva el original, se mostrará `0 %` junto con la razón, en lugar de presentar la operación como una compresión exitosa.

## Pruebas

### Unitarias

- Selección de paleta y umbral en todos los límites de calidad.
- Cálculo PSNR con imágenes opacas y transparentes.
- Escalado de paleta cuando no se alcanza el umbral.
- Calidad 100 con igualdad exacta de píxeles.
- Selección del original cuando la salida es mayor.
- Firma PNG y MIME del resultado.
- Nombre `.png` y bytes correctos en la descarga.
- Mensajes estructurados de error y recuperación del cliente del worker.

### Integración del codificador

- RGBA sintético con transparencia conserva dimensiones y canal alfa.
- Una entrada RGBA mayor de 10 MB se codifica dentro del worker.
- La salida vuelve a decodificarse para validar su estructura y fidelidad.
- No se usa un mock del codificador en estas pruebas.

### Navegador

- Subir el PNG usado en la reproducción.
- Comprimir a calidad 75.
- Confirmar tamaño menor de 80.000 bytes y reducción superior al 50 %.
- Confirmar PSNR mínimo de 52 dB.
- Descargar y comprobar firma `89 50 4E 47 0D 0A 1A 0A`.
- Confirmar ancho, alto y canal alfa; en calidad 100, comparar sus valores exactamente.
- Confirmar que no hay peticiones de red asociadas a la imagen.
- Confirmar que la interfaz permanece interactiva mientras trabaja el worker.

## Criterios de aceptación

1. Toda compresión ocurre localmente en el navegador.
2. La prueba PNG de 199.812 bytes queda por debajo de 80.000 bytes a calidad 75.
3. La misma prueba mantiene al menos 52 dB de PSNR.
4. Calidad 100 conserva exactamente el RGBA de 8 bits decodificado por el navegador.
5. Las dimensiones no cambian y el canal alfa se mantiene; por debajo de calidad 100 queda incluido en la barrera de fidelidad.
6. Todo archivo descargado como `.png` contiene bytes PNG válidos.
7. Una salida mayor nunca sustituye a un PNG original menor.
8. La cuantización no bloquea el hilo principal.
9. Los errores y límites conservan el original y se comunican al usuario.
10. Cambiar la calidad vuelve a procesar una imagen aunque el formato no cambie.

## Riesgos y decisiones

- Una reducción grande de PNG requiere normalmente cuantización; no puede ser simultáneamente sin pérdida para fotografías con muchos colores.
- PSNR es una barrera objetiva útil, pero no replica el análisis perceptual propietario de Cloudinary.
- Algunas imágenes ya optimizadas pueden reducir poco o nada.
- UPNG y el buffer RGBA aumentarán el consumo de memoria durante el procesamiento; por eso se usan worker, transferencias y límite de píxeles.
- El resultado objetivo se validó con una imagen representativa, pero el porcentaje final siempre dependerá del contenido.
