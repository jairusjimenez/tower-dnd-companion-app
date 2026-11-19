import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { VttProvider } from './context/VttContext';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VttProvider>
      <App />
    </VttProvider>
  </React.StrictMode>,
);
