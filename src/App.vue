<script setup>
  import { ref, computed, onMounted } from 'vue';
  import Toast from 'primevue/toast';
  import Button from 'primevue/button';
  import FileUpload from 'primevue/fileupload';
  import Badge from 'primevue/badge';
  import ProgressBar from 'primevue/progressbar';
  import { useToast } from 'primevue/usetoast';
  import {
    formatBytes,
    calculateReduction,
    FORMAT_OPTIONS,
    MAX_IMAGES,
    MAX_FILE_SIZE,
    MIME_TO_EXTENSION,
    COMPRESSION_QUALITY_LEVELS,
    getBatchCompressionConcurrency,
    getCompressionOutcome,
    isCompressionCurrent,
    shouldShowQualityControl
  } from './utils';
  import { useImageProcessor } from './composables/useImageProcessor';
  import { MODERN_IMAGE_WORKER_POOL_CAPACITY } from './composables/modernImageCompressionWorker';

  // Estado de la aplicación
  const images = ref([]);
  const isUploading = ref(false);
  const isProcessing = ref(false);
  const downloadingAll = ref(false);
  const selectedFormat = ref('image/webp'); // Formato de compresión predeterminado
  const compressionQuality = ref(75); // Calidad de compresión predeterminada
  const toast = useToast();
  const fileUploadRef = ref(null);

  // Formatos disponibles
  const formatOptions = [
    { value: 'image/avif', label: 'AVIF' },
    { value: 'image/png', label: 'PNG' },
    { value: 'image/webp', label: 'WEBP' },
    { value: 'image/jpeg', label: 'JPEG' },
    { value: 'image/jxl', label: 'JXL' }
  ];

  const mapWithConcurrency = async (items, concurrency, mapper) => {
    const outcomes = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const index = nextIndex++;
          try {
            outcomes[index] = {
              status: 'fulfilled',
              value: await mapper(items[index])
            };
          } catch (reason) {
            outcomes[index] = { status: 'rejected', reason };
          }
        }
      }
    );
    await Promise.all(workers);
    return outcomes;
  };

  // Composable para procesamiento de imágenes
  const { compressImage, downloadSingleImage, downloadAllImages } =
    useImageProcessor();

  // Propiedades computadas
  const hasImages = computed(() => images.value.length > 0);
  const showQualityControl = computed(() =>
    shouldShowQualityControl(selectedFormat.value)
  );
  const compressionQualityIndex = computed({
    get: () =>
      COMPRESSION_QUALITY_LEVELS.findIndex(
        level => level.value === compressionQuality.value
      ),
    set: index => {
      compressionQuality.value = COMPRESSION_QUALITY_LEVELS[Number(index)].value;
    }
  });
  const compressionQualityLabel = computed(
    () => COMPRESSION_QUALITY_LEVELS[compressionQualityIndex.value].label
  );
  const compressedImages = computed(() =>
    images.value.filter(img => img.isCompressed)
  );
  const hasCompressedImages = computed(() => compressedImages.value.length > 0);
  const originalTotalSize = computed(() => {
    return images.value.reduce((total, img) => total + img.originalSize, 0);
  });
  const compressedTotalSize = computed(() => {
    return compressedImages.value.reduce(
      (total, img) => total + img.compressedSize,
      0
    );
  });
  const totalReduction = computed(() => {
    if (!hasCompressedImages.value || originalTotalSize.value === 0)
      return '0%';
    return calculateReduction(
      originalTotalSize.value,
      compressedTotalSize.value
    );
  });

  // Gestión de carga de archivos
  const handleFileUpload = event => {
    if (isProcessing.value || isUploading.value) return;

    // Obtener archivos del evento (puede venir de diferentes formas según el evento)
    const files =
      event.files ||
      (event.originalEvent ? event.originalEvent.dataTransfer?.files : []);

    if (!files || !files.length) {
      console.error('No se detectaron archivos en el evento', event);
      return;
    }

    console.log(`Procesando ${files.length} archivos`, files);

    // Validar número máximo de archivos
    if (images.value.length + files.length > MAX_IMAGES) {
      toast.add({
        severity: 'warn',
        summary: 'Límite excedido',
        detail: `Máximo ${MAX_IMAGES} imágenes permitidas`,
        life: 3000
      });
      return;
    }

    isUploading.value = true;
    let validFiles = 0;
    const promises = [];

    for (const file of files) {
      // Validar tipo y tamaño
      if (!file.type.startsWith('image/')) {
        toast.add({
          severity: 'error',
          summary: 'Tipo de archivo inválido',
          detail: `${file.name} no es una imagen válida`,
          life: 3000
        });
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast.add({
          severity: 'error',
          summary: 'Archivo demasiado grande',
          detail: `${file.name} excede el límite de ${formatBytes(
            MAX_FILE_SIZE
          )}`,
          life: 3000
        });
        continue;
      }

      validFiles++;

      const promise = new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
          resolve({
            id: Date.now() + Math.random().toString(36).substring(2),
            name: file.name,
            originalSize: file.size,
            type: file.type,
            src: e.target.result,
            isCompressed: false
          });
        };
        reader.readAsDataURL(file);
      });

      promises.push(promise);
    }

    if (validFiles === 0) {
      isUploading.value = false;
      return;
    }

    // Cuando se carguen todas las imágenes
    Promise.all(promises).then(newImages => {
      images.value = [...images.value, ...newImages];
      isUploading.value = false;

      if (newImages.length > 0) {
        toast.add({
          severity: 'success',
          summary: 'Carga completada',
          detail: `${newImages.length} imágenes cargadas correctamente`,
          life: 3000
        });
      }

      // Limpiar el input de carga para permitir seleccionar los mismos archivos
      if (fileUploadRef.value) {
        fileUploadRef.value.clear();
      }
    });
  };

  const openFilePicker = () => {
    if (isProcessing.value || isUploading.value) return;

    fileUploadRef.value?.$el.querySelector('input')?.click();
  };

  // Compresión de imágenes
  const handleCompressAll = async () => {
    if (isProcessing.value || isUploading.value || !hasImages.value) return;

    const batchFormat = selectedFormat.value;
    const batchQuality = compressionQuality.value;
    const pendingImages = images.value.filter(
      image => !isCompressionCurrent(image, batchFormat, batchQuality)
    );
    isProcessing.value = true;
    let optimizedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;

    try {
      const outcomes = await mapWithConcurrency(
        pendingImages,
        getBatchCompressionConcurrency(
          batchFormat,
          MODERN_IMAGE_WORKER_POOL_CAPACITY
        ),
        image => compressImage(image, batchFormat, batchQuality)
      );

      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
          failedCount++;
          return;
        }

        const image = pendingImages[index];
        const result = outcome.value;
        // Actualizar datos
        image.isCompressed = true;
        image.compressedSize = result.compressedSize;
        image.compressedSrc = result.compressedSrc;
        image.compressedPreviewSrc = result.compressedPreviewSrc;
        image.compressedType = result.compressedType;
        image.compressionStatus = result.compressionStatus;
        image.compressionNotice = result.compressionNotice;
        image.compressionDetails = result.compressionDetails;
        image.compressedQuality = result.compressedQuality;
        image.compressionProfile = result.compressionProfile;

        const resultOutcome = getCompressionOutcome(result);
        if (resultOutcome === 'failed') failedCount++;
        else if (resultOutcome === 'unchanged') unchangedCount++;
        else optimizedCount++;
      });

      if (optimizedCount > 0) {
        toast.add({
          severity: 'success',
          summary: 'Compresión completada',
          detail: `${optimizedCount} imágenes comprimidas correctamente`,
          life: 3000
        });
      }

      if (unchangedCount > 0) {
        toast.add({
          severity: 'warn',
          summary: 'Original conservado',
          detail: `${unchangedCount} imágenes no consiguieron una versión más pequeña`,
          life: 4000
        });
      }

      if (failedCount > 0) {
        toast.add({
          severity: 'error',
          summary: 'Algunas imágenes no se procesaron',
          detail: `${failedCount} imágenes no se pudieron comprimir`,
          life: 4000
        });
      }
    } catch (error) {
      console.error('Error al comprimir imágenes:', error);
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Ha ocurrido un error al comprimir las imágenes',
        life: 3000
      });
    } finally {
      isProcessing.value = false;
    }
  };

  // Descarga de imágenes
  const handleDownloadAll = async () => {
    if (downloadingAll.value || !hasCompressedImages.value) return;

    downloadingAll.value = true;

    try {
      await downloadAllImages(compressedImages.value);
      toast.add({
        severity: 'success',
        summary: 'Descarga completada',
        detail: 'Archivo ZIP descargado correctamente',
        life: 3000
      });
    } catch (error) {
      console.error('Error al descargar imágenes:', error);
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Ha ocurrido un error al descargar las imágenes',
        life: 3000
      });
    } finally {
      downloadingAll.value = false;
    }
  };

  // Descarga de una imagen individual
  const handleDownloadSingle = async image => {
    if (!image.isCompressed) return;

    try {
      await downloadSingleImage(image);
      toast.add({
        severity: 'success',
        summary: 'Descarga completada',
        detail: `Imagen ${image.name} descargada correctamente`,
        life: 3000
      });
    } catch (error) {
      console.error('Error al descargar imagen:', error);
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Ha ocurrido un error al descargar la imagen',
        life: 3000
      });
    }
  };

  // Gestión de imágenes
  const clearAll = () => {
    if (isProcessing.value || isUploading.value) return;

    images.value = [];
    toast.add({
      severity: 'info',
      summary: 'Limpieza completada',
      detail: 'Se han eliminado todas las imágenes',
      life: 3000
    });
  };

  const removeImage = id => {
    if (isProcessing.value) return;

    images.value = images.value.filter(img => img.id !== id);
    toast.add({
      severity: 'info',
      summary: 'Imagen eliminada',
      detail: 'La imagen ha sido eliminada',
      life: 3000
    });
  };

  const handleFormatChange = format => {
    selectedFormat.value = format;
  };

  // Comprimir automáticamente las imágenes cuando se cargan
  const autoCompressAfterUpload = () => {
    if (hasImages.value && !isProcessing.value) {
      handleCompressAll();
    }
  };

  // Añadir modo de soltar (drag and drop) personalizado
  const onDragOver = event => {
    event.preventDefault();
    event.currentTarget.classList.add('border-blue-500');
    event.currentTarget.classList.add('bg-blue-50');
    event.currentTarget.classList.add('border-2');
  };

  const onDragLeave = event => {
    event.preventDefault();
    event.currentTarget.classList.remove('border-blue-500');
    event.currentTarget.classList.remove('bg-blue-50');
    event.currentTarget.classList.remove('border-2');
  };

  const onDrop = event => {
    event.preventDefault();
    event.currentTarget.classList.remove('border-blue-500');
    event.currentTarget.classList.remove('bg-blue-50');
    event.currentTarget.classList.remove('border-2');

    if (isProcessing.value || isUploading.value) return;

    const files = event.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload({ files });
    }
  };
</script>

<template>
  <Toast position="top-center" class="custom-toast" />

  <main class="min-h-screen max-w-4xl mx-auto p-4 flex flex-col gap-4">
    <!-- Cabecera -->
    <div class="text-center mb-4">
      <div class="flex justify-center items-end mb-2">
        <img src="/logo.svg" alt="Logo" class="size-10 mr-2" />
        <h1 class="text-2xl font-bold">PixelDiet</h1>
      </div>
      <p class="text-sm text-gray-600">
        Optimiza tus imágenes web con un solo clic, ahorra espacio sin perder
        calidad
      </p>
    </div>

    <!-- Área de carga -->
    <div
      class="rounded-lg p-5 mb-2 bg-white shadow-md transition-colors duration-200 cursor-pointer"
      :aria-disabled="isProcessing || isUploading"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="openFilePicker"
    >
      <div class="flex items-center justify-center">
        <div class="flex flex-col items-center">
          <span class="pi pi-upload text-3xl text-blue-500 mb-2"></span>
          <p class="text-sm font-medium mb-0">
            Arrastra imágenes aquí o haz clic para subir
          </p>

          <FileUpload
            ref="fileUploadRef"
            name="demo[]"
            :multiple="true"
            :disabled="isProcessing || isUploading"
            accept="image/*"
            :customUpload="true"
            @select="handleFileUpload"
            @drop="handleFileUpload"
            :showUploadButton="false"
            :showCancelButton="false"
            class="upload-area w-full"
          >
            <template #empty>
              <Button
                label="Elegir archivos"
                class="p-button-primary p-button-sm"
              />
            </template>
          </FileUpload>
        </div>
      </div>

      <div v-if="isUploading" class="mt-3">
        <ProgressBar mode="indeterminate" class="h-1" />
        <p class="text-center text-xs mt-1">Subiendo imágenes...</p>
      </div>
    </div>

    <!-- Tarjeta de controles -->
    <div
      class="bg-white rounded-lg shadow-md px-4 py-2 mb-3 flex flex-col gap-4"
    >
      <div>
        <h2 class="text-sm font-medium mb-3">Formato de salida</h2>
        <div
          class="gap-2"
          :style="{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))'
          }"
        >
          <button
            v-for="format in formatOptions"
            :key="format.value"
            :disabled="isProcessing"
            :class="[
              'rounded-lg py-[10px] px-2 text-sm font-medium transition-colors outline-none',
              selectedFormat === format.value
                ? 'bg-[#4f46e5] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
            ]"
            @click="handleFormatChange(format.value)"
          >
            {{ format.label }}
          </button>
        </div>
      </div>

      <!-- Selector de calidad -->
      <div v-if="showQualityControl">
        <div class="flex items-center justify-between mb-1">
          <label for="compression-quality" class="text-sm font-medium"
            >Calidad de compresión</label
          >
          <span class="text-sm font-medium text-blue-500"
            >{{ compressionQualityLabel }}</span
          >
        </div>
        <div class="w-full">
          <input
            id="compression-quality"
            type="range"
            min="0"
            max="2"
            step="1"
            :disabled="isProcessing"
            :aria-valuetext="compressionQualityLabel"
            v-model.number="compressionQualityIndex"
            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <div class="flex justify-between text-xs text-gray-500 mt-1">
            <span
              v-for="level in COMPRESSION_QUALITY_LEVELS"
              :key="level.value"
            >
              {{ level.label }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Botones de acción -->
    <div v-if="hasImages" class="mb-6 flex flex-col gap-4">
      <div class="flex justify-center flex-wrap items-center gap-4">
        <Button
          @click="handleCompressAll"
          :loading="isProcessing"
          :disabled="isUploading"
          :label="
            isProcessing ? 'Procesando...' : 'Comprimir todas las imágenes'
          "
          icon="pi pi-images"
          class="p-button-success w-full sm:w-auto sm:flex-1"
        />

        <!-- Botón de limpieza -->
        <Button
          @click="clearAll"
          :disabled="isProcessing || isUploading"
          label="Limpiar todo"
          icon="pi pi-trash"
          class="p-button-outlined p-button-danger w-full sm:w-auto sm:flex-2"
        />
      </div>

      <Button
        v-if="hasCompressedImages"
        @click="handleDownloadAll"
        :loading="downloadingAll"
        :disabled="isProcessing"
        :label="downloadingAll ? 'Preparando...' : 'Descargar todas (ZIP)'"
        icon="pi pi-download"
        class="w-full p-button-primary"
      />
    </div>

    <!-- Lista de imágenes -->
    <div v-if="hasImages">
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <div
          v-for="image in images"
          :key="image.id"
          class="border-b last:border-b-0 p-3"
        >
          <!-- Diseño Móvil (por defecto) y Desktop (responsivo) -->
          <div class="md:hidden">
            <!-- Solo visible en móvil -->
            <!-- Contenedor superior para imagen y botones (en fila) -->
            <div class="flex items-center justify-between mb-2">
              <!-- Imagen miniatura -->
              <img
                :src="
                  image.compressedPreviewSrc ||
                  (image.isCompressed ? image.compressedSrc : image.src)
                "
                class="w-16 h-16 object-cover rounded"
                :alt="image.name"
              />

              <!-- Botones de acción -->
              <div class="flex space-x-2">
                <Button
                  v-if="image.isCompressed"
                  @click="handleDownloadSingle(image)"
                  icon="pi pi-download"
                  class="p-button-text p-button-rounded p-button-sm"
                  v-tooltip.top="'Descargar imagen'"
                />
                <Button
                  @click="removeImage(image.id)"
                  :disabled="isProcessing"
                  icon="pi pi-times"
                  class="p-button-text p-button-rounded p-button-sm p-button-danger"
                  v-tooltip.top="'Eliminar imagen'"
                />
              </div>
            </div>

            <!-- Información de la imagen (debajo) -->
            <div class="flex-grow">
              <p class="truncate text-sm text-start font-medium">
                {{ image.name }}
                <span
                  v-if="
                    image.isCompressed && image.compressedType !== image.type
                  "
                  class="text-xs text-blue-500 block"
                >
                  →
                  {{
                    image.name.slice(0, image.name.lastIndexOf('.')) +
                    (MIME_TO_EXTENSION[image.compressedType] || '.png')
                  }}
                </span>
              </p>
              <div class="flex flex-wrap items-center text-xs mt-1">
                <span>{{ formatBytes(image.originalSize) }}</span>
                <span v-if="image.isCompressed" class="flex items-center">
                  <span class="pi pi-arrow-right text-xs mx-2"></span>
                  {{ formatBytes(image.compressedSize) }}
                  <span
                    :class="{
                      'text-green-600': !calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      ).includes('+'),
                      'text-red-600': calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      ).includes('+')
                    }"
                    class="ml-1"
                  >
                    ({{
                      calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      )
                    }})
                  </span>
                </span>
                <Badge
                  v-if="image.isCompressed"
                  :severity="
                    image.compressionStatus === 'unchanged'
                      ? 'warning'
                      : 'success'
                  "
                  :value="
                    image.compressionStatus === 'unchanged'
                      ? 'Sin cambios'
                      : 'Completado'
                  "
                  class="ml-auto"
                />
                <Badge
                  v-else
                  severity="info"
                  value="Pendiente"
                  class="ml-auto"
                />
              </div>
            </div>
          </div>

          <!-- Diseño Desktop (tres columnas) -->
          <div class="hidden md:flex md:items-center md:space-x-3">
            <!-- Solo visible en desktop -->
            <!-- Imagen miniatura (izquierda) -->
            <img
              :src="
                image.compressedPreviewSrc ||
                (image.isCompressed ? image.compressedSrc : image.src)
              "
              class="w-16 h-16 object-cover rounded"
              :alt="image.name"
            />

            <!-- Información de nombre (centro) -->
            <div class="flex-grow min-w-0">
              <div
                class="flex flex-col mb-1 text-start"
                :title="`${image.name} →
                  ${
                    image.name.slice(0, image.name.lastIndexOf('.')) +
                    (MIME_TO_EXTENSION[image.compressedType] || '.png')
                  }`"
              >
                <p class="truncate text-sm font-medium">
                  {{ image.name }}
                </p>
                <span
                  v-if="
                    image.isCompressed && image.compressedType !== image.type
                  "
                  class="truncate text-xs text-blue-500 ml-1"
                >
                  →
                  {{
                    image.name.slice(0, image.name.lastIndexOf('.')) +
                    (MIME_TO_EXTENSION[image.compressedType] || '.png')
                  }}
                </span>
              </div>
              <div class="flex flex-wrap items-center text-xs">
                <span>{{ formatBytes(image.originalSize) }}</span>
                <span v-if="image.isCompressed" class="flex items-center">
                  <span class="pi pi-arrow-right text-xs mx-2"></span>
                  {{ formatBytes(image.compressedSize) }}
                  <span
                    :class="{
                      'text-green-600': !calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      ).includes('+'),
                      'text-red-600': calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      ).includes('+')
                    }"
                    class="ml-1"
                  >
                    ({{
                      calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      )
                    }})
                  </span>
                </span>
                <Badge
                  v-if="image.isCompressed"
                  :severity="
                    image.compressionStatus === 'unchanged'
                      ? 'warning'
                      : 'success'
                  "
                  :value="
                    image.compressionStatus === 'unchanged'
                      ? 'Sin cambios'
                      : 'Completado'
                  "
                  class="ml-3"
                />
                <Badge v-else severity="info" value="Pendiente" class="ml-3" />
              </div>
            </div>

            <!-- Botones de acción (derecha) -->
            <div class="flex space-x-2">
              <Button
                v-if="image.isCompressed"
                @click="handleDownloadSingle(image)"
                icon="pi pi-download"
                class="p-button-text p-button-rounded p-button-sm"
                v-tooltip.top="'Descargar imagen'"
              />
              <Button
                @click="removeImage(image.id)"
                :disabled="isProcessing"
                icon="pi pi-times"
                class="p-button-text p-button-rounded p-button-sm p-button-danger"
                v-tooltip.top="'Eliminar imagen'"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="mt-auto text-center text-xs text-gray-500">
      <p>
        PixelDiet | Comprime y convierte imágenes directamente en tu navegador
      </p>
    </footer>
  </main>
</template>

<style scoped>
  :deep(.p-fileupload-content) {
    display: none;
  }

  :deep(.p-fileupload-buttonbar) {
    display: none;
  }

  .upload-area :deep(.p-fileupload) {
    width: 100%;
  }

  /* Mejora visual para los botones */
  :deep(.p-button) {
    font-weight: 500;
  }

  :deep(.p-button:focus:not(:focus-visible)) {
    outline: none !important;
    box-shadow: none !important;
  }

  :deep(.p-button:focus-visible) {
    outline: 2px solid #4f46e5 !important;
    outline-offset: 2px;
    box-shadow: none !important;
  }

  /* Estilos para tooltips */
  :deep(.p-tooltip .p-tooltip-text) {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
  }

  /* Estilos para los Toast */
  :deep(.p-toast) {
    opacity: 1 !important;
  }

  :deep(.p-toast .p-toast-message .p-toast-icon-close) {
    opacity: 1 !important;
    color: black !important;
    background-color: transparent !important;
    outline: none !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  :deep(.p-toast .p-toast-icon-close:focus),
  :deep(.p-toast .p-toast-icon-close:hover) {
    box-shadow: none !important;
    outline: none !important;
  }

  :deep(.p-toast .p-toast-icon-close-icon) {
    color: black !important;
    visibility: visible !important;
  }

  /* Ajustes para móviles */
  @media (max-width: 640px) {
    .grid-cols-3 {
      grid-template-columns: 1fr;
    }
  }

  /* Estilos para el control deslizante (slider) */
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    height: 8px;
    border-radius: 5px;
    background:
      radial-gradient(circle at 0% 50%, #94a3b8 0 2px, transparent 2.5px),
      radial-gradient(circle at 50% 50%, #94a3b8 0 2px, transparent 2.5px),
      radial-gradient(circle at 100% 50%, #94a3b8 0 2px, transparent 2.5px),
      #e2e8f0;
    outline: none;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  input[type='range']:focus {
    outline: none;
  }

  input[type='range']:focus-visible {
    outline: 2px solid #4f46e5;
    outline-offset: 4px;
  }

  input[type='range']::-ms-track {
    width: 100%;
    cursor: pointer;
    background: transparent;
    border-color: transparent;
    color: transparent;
  }
</style>
