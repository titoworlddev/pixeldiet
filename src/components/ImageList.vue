<script setup>
import { ref, computed } from 'vue';
import { useToast } from 'primevue/usetoast';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';
import Card from 'primevue/card';
import Badge from 'primevue/badge';
import { formatBytes, calculateReduction } from '../utils';
import { useImageProcessor } from '../composables/useImageProcessor';
import CompressionSettings from './CompressionSettings.vue';
import CompressionStats from './CompressionStats.vue';

const toast = useToast();
const { compressImage, downloadSingleImage, downloadAllImages } = useImageProcessor();

const props = defineProps({
  images: {
    type: Array,
    default: () => []
  }
});

const emits = defineEmits(['images-processed']);

const compressedImagesCount = computed(() => {
  return props.images.filter(img => img.isCompressed).length;
});

const hasCompressedImages = computed(() => compressedImagesCount.value > 0);
const showSettingsPanel = computed(() => props.images.length > 0);

const isProcessing = ref(false);
const downloadingAll = ref(false);

const handleCompressImages = async (settings) => {
  if (isProcessing.value) return;
  
  isProcessing.value = true;
  
  try {
    // Procesar cada imagen en secuencia
    for (const image of props.images) {
      const result = await compressImage(image, settings.format, settings.quality);
      
      // Actualizar los datos de la imagen comprimida
      image.isCompressed = true;
      image.compressedSize = result.compressedSize;
      image.compressedSrc = result.compressedSrc;
      image.compressedType = settings.format;
    }
    
    // Emitir evento para actualizar las imágenes en el componente padre
    emits('images-processed', [...props.images]);
    
    toast.add({
      severity: 'success',
      summary: 'Compresión completada',
      detail: `Se han comprimido ${props.images.length} imágenes correctamente`,
      life: 3000
    });
  } catch (error) {
    console.error('Error al comprimir imágenes:', error);
    
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Ha ocurrido un error al procesar las imágenes',
      life: 3000
    });
  } finally {
    isProcessing.value = false;
  }
};

const handleDownloadSingle = async (image) => {
  try {
    await downloadSingleImage(image);
    
    toast.add({
      severity: 'info',
      summary: 'Descarga iniciada',
      detail: `${image.name} se está descargando`,
      life: 2000
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

const handleDownloadAll = async () => {
  if (downloadingAll.value) return;
  
  downloadingAll.value = true;
  
  try {
    const compressedImages = props.images.filter(img => img.isCompressed);
    await downloadAllImages(compressedImages);
    
    toast.add({
      severity: 'info',
      summary: 'Descarga iniciada',
      detail: 'Todas las imágenes comprimidas se están descargando como ZIP',
      life: 2000
    });
  } catch (error) {
    console.error('Error al descargar todas las imágenes:', error);
    
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
</script>

<template>
  <div class="w-full">
    <CompressionSettings 
      v-if="showSettingsPanel" 
      :is-processing="isProcessing" 
      @process-images="handleCompressImages" 
    />
    
    <div v-if="hasCompressedImages" class="flex justify-end mb-4">
      <Button 
        @click="handleDownloadAll"
        :loading="downloadingAll"
        :label="downloadingAll ? 'Preparando...' : 'Descargar todas (.zip)'"
        icon="pi pi-download"
        class="mr-2"
        outlined
      />
    </div>
    
    <div v-if="props.images.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card v-for="image in props.images" :key="image.id" class="image-card shadow-sm">
        <template #header>
          <div class="relative">
            <img 
              :src="image.isCompressed ? image.compressedSrc : image.src" 
              :alt="image.name"
              class="w-full h-40 object-cover"
            />
            <Badge v-if="image.isCompressed" value="Comprimida" severity="success" class="absolute top-2 right-2" />
            <Badge v-else :value="image.status || 'Listo para comprimir'" severity="info" class="absolute top-2 right-2" />
          </div>
        </template>
        
        <template #title>
          <div class="truncate text-sm font-medium">{{ image.name }}</div>
        </template>
        
        <template #content>
          <div class="text-sm space-y-1">
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
          
          <div v-if="image.isCompressed" class="mt-3">
            <CompressionStats 
              :originalSize="image.originalSize" 
              :compressedSize="image.compressedSize" 
            />
          </div>
        </template>
        
        <template #footer>
          <div class="flex justify-end">
            <Button 
              v-if="image.isCompressed"
              @click="handleDownloadSingle(image)"
              icon="pi pi-download"
              class="p-button-sm"
              outlined
            />
          </div>
        </template>
      </Card>
    </div>
    
    <div v-else class="text-center py-8 bg-white rounded-lg shadow-sm">
      <div class="flex flex-col items-center">
        <i class="pi pi-image text-4xl text-gray-300 mb-3"></i>
        <p class="text-gray-500">No hay imágenes cargadas</p>
        <p class="text-sm text-gray-400 mt-1">Arrastra o selecciona imágenes para comenzar</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-card {
  transition: transform 0.2s;
}

.image-card:hover {
  transform: translateY(-5px);
}
</style>
