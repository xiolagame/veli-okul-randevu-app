import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './context/AppContext';
import { subscribeToNativeNavigationIntents } from './platform/native-navigation-intent';
import { getRuntimePlatform } from './platform/runtime-platform';
import './index.css';

if (getRuntimePlatform() !== 'WEB') document.documentElement.dataset.runtimePlatform = getRuntimePlatform().toLowerCase();

const disposeNativeNavigationIntents = subscribeToNativeNavigationIntents();
if (import.meta.hot) import.meta.hot.dispose(disposeNativeNavigationIntents);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
