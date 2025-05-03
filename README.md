# PixelDiet - Compresor de Imágenes

## Descripción

PixelDiet es una aplicación web que permite comprimir y convertir imágenes a varios formatos (AVIF, JPEG, WEBP, PNG, JXL) de manera sencilla y eficiente. La aplicación está diseñada para ser intuitiva y fácil de usar, permitiendo a los usuarios optimizar sus imágenes para uso web o compartir en medios digitales.

## Características principales

- Interfaz de arrastrar y soltar para subir imágenes
- Soporte para hasta 40 imágenes simultáneas
- Compresión automática al subir imágenes
- Selección del formato de salida (PNG, JPEG, WEBP, AVIF, JXL)
- Ajuste de calidad de compresión
- Descarga individual de imágenes
- Descarga masiva en formato ZIP
- Visualización de estadísticas de compresión

## Tecnologías utilizadas

- Vue 3 (Composition API)
- Vite
- Tailwind CSS
- PrimeVue
- JSZip
- FileSaver.js

## Instalación

```bash
# Clonar el repositorio
git clone [URL del repositorio]

# Entrar en el directorio del proyecto
cd pixeldiet

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev
```

## Estructura del proyecto

```
pixeldiet/
├── docs/                 # Documentación del proyecto
├── public/               # Recursos públicos
├── src/
│   ├── assets/           # Recursos estáticos (imágenes, fuentes, etc.)
│   ├── components/       # Componentes Vue
│   ├── composables/      # Funciones reutilizables con lógica compartida
│   ├── App.vue           # Componente principal
│   ├── main.js           # Punto de entrada de la aplicación
│   └── style.css         # Estilos globales
├── index.html            # Plantilla HTML
├── package.json          # Dependencias y scripts
└── vite.config.js        # Configuración de Vite
```

## Documentación

Puedes encontrar documentación detallada sobre el proyecto en la carpeta `docs/`:

- `analisis_funcional_tecnico.md`: Análisis funcional y técnico detallado
- `lista_tareas.md`: Lista de tareas para el desarrollo del proyecto
- `requerimientos_no_funcionales.md`: Requisitos no funcionales de la aplicación
- `pruebas_unitarias_integracion.md`: Plan de pruebas unitarias y de integración

## Scripts disponibles

```bash
# Desarrollo
npm run dev

# Construir para producción
npm run build

# Previsualizar la versión de producción
npm run preview
```

## Licencia

MIT
