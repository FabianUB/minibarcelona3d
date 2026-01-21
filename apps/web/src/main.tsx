import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n' // Initialize i18n before App renders
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <App />
    </Suspense>
  </StrictMode>,
)
