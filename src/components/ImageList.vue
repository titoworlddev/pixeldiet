<script setup>
import { ref, computed } from 'vue';
import { useToast } from 'primevue/usetoast';
import Button from 'primevue/button';
import Card from 'primevue/card';
import CompressionSettings from './CompressionSettings.vue';
import CompressionStats from './CompressionStats.vue';
import { useImageProcessor } from '../composables';
import { formatBytes, calculateReduction } from '../utils';

const props = defineProps({
  images: {
    type: Array,
    required: true
  }
});

const toast = useToast();
const emits = defineEmits(['images-processed']);
const { compressImage, downloadSingleImage, downloadAllImages } = useImageProcessor();

const isProcessing = ref(false);

const hasProcessedImages = computed(() => {
  return props.images.some(img => img.isCompressed);
});

const totalOriginalSize = computed(() => {
  return props.images.reduce((total, img) => total + img.originalSize, 0);
});

const totalCompressedSize = computed(() => {
  return props.images.reduce((total, img) => total + (img.compressedSize || 0), 0);
});

const processAllImages = async (config) => {
  isProcessing.value = true;
  
  try {
    // Procesar cada imagen en secuencia
    for (const image of props.images) {
      const result = await compressImage(image, config.format, config.quality);
      
      // Actualizar los datos de la imagen comprimida
      image.isCompressed = true;
      image.compressedSize = result.compressedSize;
      image.compressedSrc = result.compressedSrc;
      image.compressedType = config.format;
    }
    
    // Notificar que las imágenes han sido procesadas
    emits('images-processed', props.images);
    
    // Mostrar notificación de éxito
    toast.add({
      severity: 'success',
      summary: 'Compresión completada',
      detail: `Se han comprimido ${props.images.length} imágenes correctamente`,
      life: 3000
    });
  } catch (error) {
    console.error('Error al procesar imágenes:', error);
    
    // Mostrar notificación de error
    toast.add({
      severity: 'error',
      summary: 'Error de compresión',
      detail: 'Ha ocurrido un error al comprimir las imágenes',
      life: 3000
    });
  } finally {
    isProcessing.value = false;
  }
};

const handleDownloadAll = () => {
  try {
    downloadAllImages(props.images);
    
    toast.add({
      severity: 'info',
      summary: 'Descarga iniciada',
      detail: props.images.length > 1 ? 'Descargando todas las imágenes en formato ZIP' : 'Descargando imagen',
      life: 3000
    });
  } catch (error) {
    console.error('Error al descargar:', error);
    toast.add({
      severity: 'error',
      summary: 'Error de descarga',
      detail: 'No se pudo iniciar la descarga',
      life: 3000
    });
  }
};

const handleDownloadSingle = (image) => {
  try {
    downloadSingleImage(image);
    
    toast.add({
      severity: 'info',
      summary: 'Descarga iniciada',
      detail: `Descargando ${image.name}`,
      life: 3000
    });
  } catch (error) {
    console.error('Error al descargar:', error);
    toast.add({
      severity: 'error',
      summary: 'Error de descarga',
      detail: 'No se pudo iniciar la descarga',
      life: 3000
    });
  }
};
</script>

<template>
  <div v-if="images.length > 0" class="w-full max-w-5xl mx-auto">
    <!-- Panel de configuración de compresión -->
    <CompressionSettings 
      :is-processing="isProcessing" 
      @process-images="processAllImages" 
    />
    
    <!-- Mostrar estadísticas de compresión si hay imágenes procesadas -->
    <div v-if="hasProcessedImages" class="mb-6 flex flex-col gap-4">
      <div class="flex justify-between items-center">
        <h3 class="text-lg font-medium">Estadísticas de compresión</h3>
        <Button 
          @click="handleDownloadAll" 
          label="Descargar todas" 
          icon="pi pi-download"
          class="btn-download"
        />
      </div>
      
      <CompressionStats 
        :original-size="totalOriginalSize" 
        :compressed-size="totalCompressedSize" 
      />
    </div>
    
    <!-- Cuadrícula de imágenes -->
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      <Card v-for="image in images" :key="image.id" class="image-card card-hover">
        <template #header>
          <div class="relative image-preview">
            <img :src="image.isCompressed ? image.compressedSrc : image.src" class="w-full h-48 object-contain bg-gray-100" />
          </div>
        </template>
        
        <template #title>
          <div class="truncate text-sm font-medium">{{ image.name }}</div>
        </template>
        
        <template #content>
          <div class="text-xs text-gray-500">
            <p>Original: {{ formatBytes(image.originalSize) }}</p>
            <p v-if="image.isCompressed">
              Comprimido: {{ formatBytes(image.compressedSize) }}
              <span :class="{
                'text-green-600': !calculateReduction(image.originalSize, image.compressedSize).includes('+'),
                'text-red-600': calculateReduction(image.originalSize, image.compressedSize).includes('+')
              }" class="ml-1">
                ({{ calculateReduction(image.originalSize, image.compressedSize) }})
              </span>
            </p>
          </div>
        </template>
        
        <template #footer>
          <div class="flex justify-end">
            <Button 
              v-if="image.isCompressed"
              @click="handleDownloadSingle(image)" 
              icon="pi pi-download" 
              text 
              size="small" 
              class="p-button-sm"
            />
          </div>
        </template>
      </Card>
    </div>
  </div>
  
  <div v-else class="text-center py-8">
    <p class="text-gray-500">No hay imágenes para mostrar.</p>
    <p class="text-sm text-gray-400">Sube algunas imágenes para comenzar.</p>
  </div>
</template>

<style scoped>
/* Los estilos ahora se manejan principalmente a través del archivo global.css */
</style>
