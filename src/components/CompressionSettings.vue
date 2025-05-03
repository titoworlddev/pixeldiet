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
  <div class="bg-white rounded-lg shadow-sm p-4 mb-6">
    <h3 class="text-lg font-medium mb-3">Configuración de compresión</h3>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label class="block mb-2 text-sm font-medium">Formato de salida</label>
        <SelectButton v-model="selectedFormat" :options="FORMAT_OPTIONS" optionLabel="name" optionValue="value" />
      </div>
      
      <div>
        <label class="block mb-2 text-sm font-medium">Calidad de compresión: {{ compressionQuality }}%</label>
        <Slider v-model="compressionQuality" class="w-full" :min="1" :max="100" />
      </div>
    </div>
    
    <div class="mt-4">
      <Button 
        @click="handleProcessImages" 
        :loading="isProcessing"
        :label="isProcessing ? 'Procesando...' : 'Comprimir todas las imágenes'"
        icon="pi pi-compress"
        class="w-auto btn-compress"
      />
    </div>
  </div>
</template>
