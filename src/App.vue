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
    if (isProcessing.value || isUploading.value) return;
    event.currentTarget.classList.add('is-dragging');
  };

  const onDragLeave = event => {
    event.preventDefault();
    event.currentTarget.classList.remove('is-dragging');
  };

  const onDrop = event => {
    event.preventDefault();
    event.currentTarget.classList.remove('is-dragging');

    if (isProcessing.value || isUploading.value) return;

    const files = event.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload({ files });
    }
  };
</script>

<template>
  <Toast position="top-center" class="custom-toast" />

  <main
    class="min-h-screen max-w-4xl lg:max-w-6xl mx-auto p-4 flex flex-col gap-4"
  >
    <!-- Cabecera -->
    <header class="app-header text-center">
      <div class="app-header-brand flex justify-center">
        <img src="/logo.svg" alt="Logo" class="size-10 mr-2" />
        <h1 class="text-2xl font-bold">PixelDiet</h1>
      </div>
      <p class="app-subtitle app-text-secondary text-sm">
        Optimiza tus imágenes web con un solo clic, ahorra espacio sin perder
        calidad
      </p>
    </header>

    <div
      class="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch"
      style="display: grid"
    >
      <!-- Área de carga -->
      <div
        class="app-panel app-upload-panel rounded-lg p-5 mb-2 transition-colors duration-200 lg:mb-0 lg:flex lg:flex-col lg:justify-center"
        role="button"
        :tabindex="isProcessing || isUploading ? -1 : 0"
        aria-label="Subir imágenes"
        :aria-disabled="isProcessing || isUploading"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @click="openFilePicker"
        @keydown.enter.prevent="openFilePicker"
        @keydown.space.prevent="openFilePicker"
      >
        <div class="flex items-center justify-center">
          <div class="flex flex-col items-center">
            <span class="pi pi-upload app-accent-primary text-3xl mb-2"></span>
            <p class="sm:hidden text-sm font-medium mb-0">
              Subir imágenes
            </p>
            <p class="hidden sm:block text-sm font-medium mb-0">
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
        class="app-panel rounded-lg px-4 py-2 mb-3 flex flex-col gap-4 lg:mb-0"
      >
        <div>
          <h2 class="text-sm font-medium mb-3">Formato de salida</h2>
          <div class="format-options-grid gap-2" style="display: grid">
            <button
              v-for="format in formatOptions"
              :key="format.value"
              :disabled="isProcessing"
              :class="[
                'format-option rounded-lg py-[10px] px-2 text-sm font-medium transition-colors',
                selectedFormat === format.value
                  ? 'format-option--active'
                  : 'format-option--inactive'
              ]"
              @click="handleFormatChange(format.value)"
            >
              {{ format.label }}
            </button>
          </div>
        </div>

        <!-- Selector de calidad -->
        <div v-if="showQualityControl">
          <div class="flex items-center justify-between mb-2">
            <label for="compression-quality" class="text-sm font-medium"
              >Calidad de compresión</label
            >
            <span class="app-accent-primary text-sm font-medium"
              >{{ compressionQualityLabel }}</span
            </span>
          </div>
          <div class="w-full">
            <div class="quality-slider-track">
              <div class="quality-slider-marks" aria-hidden="true">
                <span
                  v-for="level in COMPRESSION_QUALITY_LEVELS"
                  :key="level.value"
                  class="quality-slider-mark"
                ></span>
              </div>
              <input
                id="compression-quality"
                type="range"
                min="0"
                max="2"
                step="1"
                :disabled="isProcessing"
                :aria-valuetext="compressionQualityLabel"
                v-model.number="compressionQualityIndex"
                class="quality-slider w-full h-2 rounded-lg appearance-none"
              />
            </div>
            <div class="app-text-muted flex justify-between text-xs mt-1">
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
    </div>

    <!-- Botones de acción -->
    <div v-if="hasImages" class="flex flex-col gap-4 lg:mb-6">
      <div class="flex justify-center flex-wrap items-center gap-4">
        <Button
          @click="handleCompressAll"
          :loading="isProcessing"
          :disabled="isProcessing || isUploading"
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
        :disabled="isProcessing || downloadingAll"
        :label="downloadingAll ? 'Preparando...' : 'Descargar todas (ZIP)'"
        icon="pi pi-download"
        class="w-full p-button-primary"
      />
    </div>

    <!-- Lista de imágenes -->
    <div v-if="hasImages">
      <div class="app-panel image-list rounded-lg overflow-hidden">
        <div
          v-for="image in images"
          :key="image.id"
          class="image-list-row p-3"
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
                  :aria-label="`Descargar ${image.name}`"
                  class="p-button-text p-button-rounded p-button-sm"
                  v-tooltip.top="'Descargar imagen'"
                />
                <Button
                  @click="removeImage(image.id)"
                  :disabled="isProcessing"
                  icon="pi pi-times"
                  :aria-label="`Eliminar ${image.name}`"
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
                  class="app-accent-primary text-xs block"
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
                      'app-text-success': !calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      ).includes('+'),
                      'app-text-error': calculateReduction(
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
                  class="app-accent-primary truncate text-xs ml-1"
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
                      'app-text-success': !calculateReduction(
                        image.originalSize,
                        image.compressedSize
                      ).includes('+'),
                      'app-text-error': calculateReduction(
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
                :aria-label="`Descargar ${image.name}`"
                class="p-button-text p-button-rounded p-button-sm"
                v-tooltip.top="'Descargar imagen'"
              />
              <Button
                @click="removeImage(image.id)"
                :disabled="isProcessing"
                icon="pi pi-times"
                :aria-label="`Eliminar ${image.name}`"
                class="p-button-text p-button-rounded p-button-sm p-button-danger"
                v-tooltip.top="'Eliminar imagen'"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <section v-else class="empty-results" aria-labelledby="empty-results-title">
      <i class="pi pi-images empty-results-icon" aria-hidden="true"></i>
      <h2 id="empty-results-title" class="empty-results-title">
        Aún no hay imágenes
      </h2>
      <p class="empty-results-copy">
        Súbelas y comprímelas directamente en tu navegador, <br/>sin que salgan de
        tu dispositivo.
      </p>
    </section>

    <!-- Footer -->
    <footer class="app-text-muted mt-auto text-center text-xs">
      <p>
        PixelDiet | Comprime y convierte imágenes directamente en tu navegador
      </p>
    </footer>
  </main>
</template>

<style scoped>
  .app-header {
    margin-top: -0.5rem;
  }

  .app-header-brand {
    align-items: center;
  }

  .app-subtitle {
    display: none;
  }

  @media (min-width: 768px) {
    .app-header {
      margin-top: 0;
      margin-bottom: 1rem;
    }

    .app-header-brand {
      align-items: flex-end;
      margin-bottom: 0.5rem;
    }

    .app-subtitle {
      display: block;
    }
  }

  .app-panel {
    background-color: var(--app-surface);
    border: 1px solid var(--app-border);
    color: var(--app-text);
  }

  .app-upload-panel {
    cursor: pointer;
  }

  .app-upload-panel:not([aria-disabled='true']):hover {
    border-color: var(--app-border);
  }

  .app-upload-panel.is-dragging {
    background-color: rgba(129, 140, 248, 0.12);
    border-color: var(--primary-contrast);
  }

  .app-upload-panel[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .app-upload-panel:focus:not(:focus-visible) {
    outline: none;
  }

  .app-upload-panel:focus-visible {
    outline: 2px solid var(--app-focus);
    outline-offset: 2px;
  }

  .app-text-secondary {
    color: var(--app-text-secondary);
  }

  .app-text-muted {
    color: var(--app-text-muted);
  }

  .app-accent-primary {
    color: var(--primary-contrast);
  }

  .app-text-success {
    color: var(--success-text);
  }

  .app-text-error {
    color: var(--error-text);
  }

  .format-option {
    border: 1px solid transparent;
  }

  .format-option--active {
    background-color: var(--primary-color);
    color: #ffffff;
  }

  .format-option--inactive {
    background-color: var(--app-surface-raised);
    border-color: var(--app-border);
    color: var(--app-text-secondary);
  }

  .format-option--inactive:not(:disabled):hover {
    background-color: var(--app-surface-hover);
    border-color: var(--app-border);
  }

  .format-option:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .format-option:focus:not(:focus-visible) {
    outline: none !important;
  }

  .format-option:focus-visible {
    outline: 2px solid var(--app-focus) !important;
    outline-offset: 2px;
  }

  .image-list-row {
    border-bottom: 1px solid var(--app-border);
    transition: background-color 0.2s ease;
  }

  .image-list-row:last-child {
    border-bottom: 0;
  }

  .image-list-row img {
    box-shadow: 0 0 0 1px var(--app-border);
  }

  .empty-results {
    display: flex;
    min-height: 14rem;
    padding: 3rem 1rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  .empty-results-icon {
    margin-bottom: 1rem;
    color: var(--primary-contrast);
    font-size: 2rem;
  }

  .empty-results-title {
    color: var(--app-text-secondary);
    font-size: 1.125rem;
    font-weight: 600;
  }

  .empty-results-copy {
    max-width: 30rem;
    margin: 0.375rem auto 0;
    color: var(--app-text-muted);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  @media (min-width: 768px) {
    .empty-results {
      min-height: 16rem;
    }
  }

  @media (hover: hover) {
    .image-list-row:hover {
      background-color: var(--app-surface-hover);
    }
  }

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
    outline: 2px solid var(--app-focus) !important;
    outline-offset: 2px;
    box-shadow: none !important;
  }

  .format-options-grid {
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  }

  @media (min-width: 1024px) {
    .format-options-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
  }

  /* Estilos para los Toast */
  :deep(.p-toast) {
    opacity: 1 !important;
  }

  :deep(.p-toast .p-toast-message .p-toast-icon-close) {
    opacity: 1 !important;
    color: inherit !important;
    background-color: transparent !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  :deep(.p-toast .p-toast-icon-close:focus:not(:focus-visible)),
  :deep(.p-toast .p-toast-icon-close:hover) {
    box-shadow: none !important;
    outline: none !important;
  }

  :deep(.p-toast .p-toast-icon-close:focus-visible) {
    outline: 2px solid var(--app-focus) !important;
    outline-offset: 2px;
    box-shadow: none !important;
  }

  :deep(.p-toast .p-toast-icon-close-icon) {
    color: inherit !important;
    visibility: visible !important;
  }

  /* Ajustes para móviles */
  @media (max-width: 640px) {
    .grid-cols-3 {
      grid-template-columns: 1fr;
    }
  }

  /* Estilos para el control deslizante (slider) */
  .quality-slider-track {
    position: relative;
    height: 8px;
    border-radius: 5px;
    background-color: var(--app-surface-raised);
  }

  .quality-slider-marks {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;
  }

  .quality-slider-mark {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: #64748b;
  }

  input[type='range'] {
    position: absolute;
    inset: 0;
    margin: 0;
    -webkit-appearance: none;
    appearance: none;
    height: 8px;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    outline: none;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--primary-contrast);
    cursor: pointer;
    border: 2px solid var(--app-surface);
    box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.45);
  }

  input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--primary-contrast);
    cursor: pointer;
    border: 2px solid var(--app-surface);
    box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.45);
  }

  input[type='range']:focus {
    outline: none;
  }

  input[type='range']:focus-visible {
    outline: 2px solid var(--app-focus);
    outline-offset: 4px;
  }

  input[type='range']:disabled {
    cursor: not-allowed !important;
    opacity: 0.55;
  }

  input[type='range']:disabled::-webkit-slider-thumb {
    cursor: not-allowed;
  }

  input[type='range']:disabled::-moz-range-thumb {
    cursor: not-allowed;
  }

  input[type='range']::-ms-track {
    width: 100%;
    cursor: pointer;
    background: transparent;
    border-color: transparent;
    color: transparent;
  }
</style>
