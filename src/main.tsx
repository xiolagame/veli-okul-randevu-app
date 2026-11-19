import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './context/AppContext';
import { subscribeToNativeNavigationIntents } from './platform/native-navigation-intent';
import { getRuntimePlatform } from './platform/runtime-platform';
import './index.css';
import './components/web-scene.css';
import './components/help-presentation.css';
import './components/dashboard-presentation.css';

if (getRuntimePlatform() === 'ANDROID') document.documentElement.dataset.runtimePlatform = 'android';
if (getRuntimePlatform() === 'WEB') document.documentElement.dataset.webScene = 'school';

const disposeNativeNavigationIntents = subscribeToNativeNavigationIntents();
if (import.meta.hot) import.meta.hot.dispose(disposeNativeNavigationIntents);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
