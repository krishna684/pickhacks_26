import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppAuthProvider } from './auth.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppAuthProvider>
      <App />
    </AppAuthProvider>
  </StrictMode>,
);
