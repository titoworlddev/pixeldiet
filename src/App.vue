<script setup>
import { ref } from 'vue';
import Toast from 'primevue/toast';
import { ImageUploader, ImageList } from './components';

const images = ref([]);

const handleUploadComplete = (uploadedImages) => {
  images.value = uploadedImages;
};

const handleImagesProcessed = (processedImages) => {
  // Actualizar el estado de las imágenes después del procesamiento
  images.value = [...processedImages];
};
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <Toast />
    
    <header class="bg-white shadow-sm py-4">
      <div class="container mx-auto px-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <span class="pi pi-image text-xl mr-2 text-blue-500"></span>
            <h1 class="text-xl font-semibold text-gray-800">Squish</h1>
          </div>
          <div class="text-sm text-gray-500">
            Comprime y convierte tus imágenes a AVIF, JPEG, WEBP, PNG, o JXL
          </div>
        </div>
      </div>
    </header>
    
    <main class="container mx-auto px-4 py-8">
      <div class="flex flex-col items-center">
        <ImageUploader @upload-complete="handleUploadComplete" />
        
        <ImageList 
          :images="images" 
          @images-processed="handleImagesProcessed" 
        />
      </div>
    </main>
    
    <footer class="bg-white border-t py-4 mt-auto">
      <div class="container mx-auto px-4 text-center text-sm text-gray-500">
        <p>Squish - Compresor de imágenes {{ new Date().getFullYear() }}</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Add your styles here */
</style>
