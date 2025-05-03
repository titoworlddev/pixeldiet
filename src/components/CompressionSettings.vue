<script setup>
import { ref } from 'vue';
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import Slider from 'primevue/slider';
import { FORMAT_OPTIONS, DEFAULT_COMPRESSION_CONFIG } from '../utils';

const props = defineProps({
  isProcessing: {
    type: Boolean,
    default: false
  }
});

const emits = defineEmits(['process-images']);

const selectedFormat = ref(DEFAULT_COMPRESSION_CONFIG.format);
const compressionQuality = ref(DEFAULT_COMPRESSION_CONFIG.quality);

const handleProcessImages = () => {
  emits('process-images', {
    format: selectedFormat.value,
    quality: compressionQuality.value
  });
};
</script>

<template>
  <div class="bg-white rounded-lg shadow-sm p-4 mb-4">
    <h3 class="text-lg font-medium mb-3">Configuración de compresión</h3>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label class="block mb-2 text-sm font-medium">Formato de salida</label>
        <SelectButton 
          v-model="selectedFormat" 
          :options="FORMAT_OPTIONS" 
          optionLabel="name" 
          optionValue="value"
          class="format-selector"
        />
      </div>
      
      <div>
        <label class="block mb-2 text-sm font-medium">Calidad de compresión: {{ compressionQuality }}%</label>
        <Slider v-model="compressionQuality" class="w-full" :min="1" :max="100" />
      </div>
    </div>
    
    <div class="mt-4 flex justify-center">
      <Button 
        @click="handleProcessImages" 
        :loading="isProcessing"
        :label="isProcessing ? 'Procesando...' : 'Comprimir todas las imágenes'"
        icon="pi pi-compress"
        severity="primary"
        class="w-auto"
      />
    </div>
  </div>
</template>

<style scoped>
.format-selector :deep(.p-button) {
  background-color: #f3f4f6;
  border-color: #d1d5db;
  color: #4b5563;
}

.format-selector :deep(.p-button.p-highlight) {
  background-color: #4f46e5;
  border-color: #4f46e5;
  color: white;
}
</style>
