import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { AppDataProvider } from './app/AppData';
import { SyncProvider } from './sync/SyncProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <SyncProvider>
        <AppDataProvider>
          <App />
        </AppDataProvider>
      </SyncProvider>
    </HashRouter>
  </StrictMode>,
);
