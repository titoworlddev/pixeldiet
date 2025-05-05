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
    MIME_TO_EXTENSION
  } from './utils';
  import { useImageProcessor } from './composables/useImageProcessor';

  // Estado de la aplicación
  const images = ref([]);
  const isUploading = ref(false);
  const isProcessing = ref(false);
  const downloadingAll = ref(false);
  const selectedFormat = ref('image/png');
  const compressionQuality = ref(75); // Calidad de compresión predeterminada
  const toast = useToast();
  const fileUploadRef = ref(null);

  // Formatos disponibles
  const formatOptions = [
    { value: 'image/avif', label: 'AVIF' }, // Va mal
    { value: 'image/jpeg', label: 'JPEG' }, // No esta mal
    { value: 'image/jxl', label: 'JXL' }, // Va mal
    { value: 'image/png', label: 'PNG' }, // Va bien
    { value: 'image/webp', label: 'WEBP' } // Va bien
  ];

  // Composable para procesamiento de imágenes
  const { compressImage, downloadSingleImage, downloadAllImages } =
    useImageProcessor();

  // Propiedades computadas
  const hasImages = computed(() => images.value.length > 0);
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

  // Compresión de imágenes
  const handleCompressAll = async () => {
    if (isProcessing.value || !hasImages.value) return;

    isProcessing.value = true;
    let compressedCount = 0;

    try {
      // Comprimir cada imagen
      for (const image of images.value) {
        // Si ya está comprimida en el formato seleccionado, saltarla
        if (image.isCompressed && image.compressedType === selectedFormat.value)
          continue;

        // Comprimir imagen
        const result = await compressImage(
          image,
          selectedFormat.value,
          compressionQuality.value
        );

        // Actualizar datos
        image.isCompressed = true;
        image.compressedSize = result.compressedSize;
        image.compressedSrc = result.compressedSrc;
        image.compressedType = result.compressedType;
        compressedCount++;
      }

      if (compressedCount > 0) {
        toast.add({
          severity: 'success',
          summary: 'Compresión completada',
          detail: `${compressedCount} imágenes comprimidas correctamente`,
          life: 3000
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
    images.value = [];
    toast.add({
      severity: 'info',
      summary: 'Limpieza completada',
      detail: 'Se han eliminado todas las imágenes',
      life: 3000
    });
  };

  const removeImage = id => {
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
      <div class="flex items-center justify-center mb-1">
        <span class="pi pi-image text-xl mr-2 text-blue-500"></span>
        <h1 class="text-2xl font-bold">PixelDiet</h1>
      </div>
      <p class="text-sm text-gray-600">
        Optimiza tus imágenes web con un solo clic, ahorra espacio sin perder
        calidad
      </p>
    </div>

    <!-- Tarjeta de controles -->
    <div class="bg-white rounded-lg shadow-md px-4 py-2 flex flex-col gap-4">
      <div>
        <h2 class="text-sm font-medium mb-3">Formato de salida</h2>
        <div
          class="gap-2"
          :style="{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))'
          }"
        >
          <button
            v-for="format in formatOptions"
            :key="format.value"
            :class="[
              'rounded py-2 px-2 text-sm font-medium transition-colors outline-none',
              selectedFormat === format.value
                ? 'bg-[#4f46e5] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            ]"
            @click="handleFormatChange(format.value)"
          >
            {{ format.label }}
          </button>
        </div>
      </div>

      <!-- Selector de calidad -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <h2 class="text-sm font-medium">Calidad de compresión</h2>
          <span class="text-sm font-medium text-blue-500"
            >{{ compressionQuality }}%</span
          >
        </div>
        <div class="w-full">
          <input
            type="range"
            min="30"
            max="100"
            step="1"
            v-model="compressionQuality"
            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <div class="flex justify-between text-xs text-gray-500 mt-1">
            <span>Baja (30%)</span>
            <span>Alta (100%)</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Área de carga -->
    <div
      class="rounded-lg p-5 mb-4 bg-white shadow-md transition-colors duration-200 cursor-pointer"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="
        $refs.fileUploadRef &&
          $refs.fileUploadRef.$el.querySelector('input').click()
      "
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
            accept="image/*"
            :auto="true"
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

    <!-- Botones de acción -->
    <div v-if="hasImages" class="mb-6">
      <Button
        @click="handleCompressAll"
        :loading="isProcessing"
        :label="isProcessing ? 'Procesando...' : 'Comprimir todas las imágenes'"
        icon="pi pi-images"
        class="w-full p-button-success mb-2"
      />

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
          class="border-b last:border-b-0 p-3 flex items-center"
        >
          <img
            :src="image.isCompressed ? image.compressedSrc : image.src"
            class="w-16 h-16 object-cover rounded mr-3"
            :alt="image.name"
          />

          <div class="flex-grow min-w-0">
            <p class="truncate text-sm font-medium">
              {{ image.name }}
              <span
                v-if="image.isCompressed && image.compressedType !== image.type"
                class="text-xs text-blue-500"
              >
                → {{ image.name.split('.')[0] + (MIME_TO_EXTENSION[image.compressedType] || '.png') }}
              </span>
            </p>
            <div class="flex items-center text-xs space-x-2">
              <span>{{ formatBytes(image.originalSize) }}</span>
              <span v-if="image.isCompressed" class="flex items-center">
                <span class="pi pi-arrow-right text-xs mx-1"></span>
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
                severity="success"
                value="Completado"
                class="ml-1"
              />
              <Badge v-else severity="info" value="Pendiente" class="ml-1" />
            </div>
          </div>

          <div class="flex space-x-2 ml-2">
            <Button
              v-if="image.isCompressed"
              @click="handleDownloadSingle(image)"
              icon="pi pi-download"
              class="p-button-text p-button-rounded p-button-sm"
              v-tooltip.top="'Descargar imagen'"
            />
            <Button
              @click="removeImage(image.id)"
              icon="pi pi-times"
              class="p-button-text p-button-rounded p-button-sm p-button-danger"
              v-tooltip.top="'Eliminar imagen'"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Botón de limpieza -->
    <div v-if="hasImages" class="flex justify-center">
      <Button
        @click="clearAll"
        label="Limpiar todo"
        icon="pi pi-trash"
        class="p-button-outlined p-button-danger"
      />
    </div>

    <!-- Footer -->
    <footer class="mt-auto text-center text-xs text-gray-500">
      <p>
        PixelDiet v1.0.0 | Comprime y convierte imágenes directamente en tu
        navegador
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
    background: #e2e8f0;
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

  input[type='range']::-ms-track {
    width: 100%;
    cursor: pointer;
    background: transparent;
    border-color: transparent;
    color: transparent;
  }
</style>
