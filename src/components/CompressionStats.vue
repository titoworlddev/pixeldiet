<script setup>
import { computed } from 'vue';
import { formatBytes, calculateReduction } from '../utils';

const props = defineProps({
  originalSize: {
    type: Number,
    required: true
  },
  compressedSize: {
    type: Number,
    required: true
  }
});

const compressionRatio = computed(() => calculateReduction(props.originalSize, props.compressedSize));
</script>

<template>
  <div class="bg-gray-50 p-3 rounded">
    <div class="flex justify-between items-center">
      <div>
        <p class="text-sm">Tamaño original: <span class="font-medium">{{ formatBytes(props.originalSize) }}</span></p>
        <p class="text-sm">Tamaño comprimido: <span class="font-medium">{{ formatBytes(props.compressedSize) }}</span></p>
      </div>
      <div>
        <div class="text-center">
          <span class="text-xl font-bold text-green-600">{{ compressionRatio }}%</span>
          <p class="text-xs text-gray-500">Reducción</p>
        </div>
      </div>
    </div>
  </div>
</template>
