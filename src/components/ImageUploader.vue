<script setup>
  import { ref, computed } from 'vue';
  import { useToast } from 'primevue/usetoast';
  import Button from 'primevue/button';
  import FileUpload from 'primevue/fileupload';
  import ProgressBar from 'primevue/progressbar';
  import { MAX_IMAGES, MAX_FILE_SIZE } from '../utils';

  const toast = useToast();
  const files = ref([]);
  const isUploading = ref(false);
  const fileUploadRef = ref(null);

  const hasFiles = computed(() => files.value.length > 0);

  const emits = defineEmits(['upload-complete']);

  // Función que maneja la selección de archivos
  const onSelect = event => {
    const uploadedFiles = event.files;
    processFiles(uploadedFiles);
  };

  // Función que maneja cuando se arrastran archivos
  const onDrop = event => {
    const uploadedFiles = event.files;
    processFiles(uploadedFiles);
  };

  // Función que procesa los archivos
  const processFiles = uploadedFiles => {
    isUploading.value = true;

    // Validar límite de imágenes
    if (files.value.length + uploadedFiles.length > MAX_IMAGES) {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: `No puedes subir más de ${MAX_IMAGES} imágenes`,
        life: 3000
      });
      isUploading.value = false;
      return;
    }

    let validFileCount = 0;

    // Validar que solo sean imágenes
    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];

      // Validar tipo de archivo
      if (!file.type.startsWith('image/')) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: `${file.name} no es una imagen válida`,
          life: 3000
        });
        continue;
      }

      // Validar tamaño máximo
      if (file.size > MAX_FILE_SIZE) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: `${file.name} excede el tamaño máximo permitido de 10MB`,
          life: 3000
        });
        continue;
      }

      validFileCount++;

      // Añadir metadatos necesarios a cada archivo
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = {
          id: Date.now() + i, // ID único
          name: file.name,
          originalSize: file.size,
          type: file.type,
          originalType: file.type,
          src: e.target.result,
          compressionQuality: 75,
          isCompressed: false,
          compressedSize: 0,
          compressedSrc: '',
          status: 'Listo para comprimir' // Cambiamos el estado de 'Pending' a algo más descriptivo
        };

        files.value.push(imageData);

        // Comprobar si hemos procesado todos los archivos válidos
        if (files.value.length === validFileCount) {
          isUploading.value = false;
          emits('upload-complete', files.value);

          // Notificación de éxito
          if (validFileCount > 1) {
            toast.add({
              severity: 'success',
              summary: 'Imágenes cargadas',
              detail: `Se han cargado ${validFileCount} imágenes correctamente`,
              life: 3000
            });
          } else if (validFileCount === 1) {
            toast.add({
              severity: 'success',
              summary: 'Imagen cargada',
              detail: 'La imagen se ha cargado correctamente',
              life: 3000
            });
          }
        }
      };

      reader.readAsDataURL(file);
    }

    // Si no hay archivos válidos
    if (validFileCount === 0) {
      isUploading.value = false;
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se ha cargado ninguna imagen válida',
        life: 3000
      });
    }
  };

  const clearFiles = () => {
    files.value = [];
    emits('upload-complete', []);

    toast.add({
      severity: 'info',
      summary: 'Limpieza completada',
      detail: 'Se han eliminado todas las imágenes',
      life: 2000
    });
  };
</script>

<template>
  <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
    <h2 class="text-lg font-medium mb-3">Subir imágenes para compresión</h2>

    <FileUpload
      ref="fileUploadRef"
      name="images[]"
      :multiple="true"
      accept="image/*"
      :maxFileSize="MAX_FILE_SIZE"
      :customUpload="true"
      @select="onSelect"
      @drop="onDrop"
      chooseLabel="Elegir"
      cancelLabel="Cancelar"
      class="w-full"
      :auto="true"
    >
      <template #empty>
        <div class="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-300 rounded-lg upload-zone">
          <i class="pi pi-image text-3xl text-blue-500 mb-2"></i>
          <p class="text-gray-700 mb-0">Arrastra y suelta imágenes aquí o haz clic para seleccionar</p>
          <p class="text-sm text-gray-500 mt-1">Formatos soportados: PNG, JPG, WEBP, AVIF</p>
          <p class="text-sm text-gray-500">Máximo {{ MAX_IMAGES }} imágenes</p>
        </div>
      </template>
    </FileUpload>

    <div v-if="isUploading" class="w-full mt-3">
      <ProgressBar mode="indeterminate" class="h-2" />
      <p class="text-center text-sm mt-1">Procesando imágenes...</p>
    </div>

    <div v-if="hasFiles" class="w-full mt-3 flex justify-end">
      <Button 
        icon="pi pi-trash" 
        severity="danger" 
        outlined
        @click="clearFiles"
        label="Limpiar todas"
      />
    </div>
  </div>
</template>
