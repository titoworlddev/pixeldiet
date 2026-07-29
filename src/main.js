import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// PrimeVue y sus estilos
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import 'primevue/resources/themes/lara-dark-indigo/theme.css'  // tema
import 'primevue/resources/primevue.min.css'
import 'primeicons/primeicons.css'
import 'primeflex/primeflex.css'
import './assets/css/global.css'

const app = createApp(App)

// Registrar PrimeVue
app.use(PrimeVue)
app.use(ToastService)
app.directive('tooltip', Tooltip)

// Proporcionar el servicio de Toast
app.provide('toast', app.config.globalProperties.$toast)

app.mount('#app')
