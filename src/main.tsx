import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './context/AppContext';
import { subscribeToNativeNavigationIntents } from './platform/native-navigation-intent';
import { getRuntimePlatform } from './platform/runtime-platform';
import './index.css';
import './theme.css';
import './android-auth.css';
import { subscribeAndroidSystemBars } from './platform/android-system-bars';
import {ReviewBanner} from './components/ReviewBanner';

if (getRuntimePlatform() !== 'WEB') document.documentElement.dataset.runtimePlatform = getRuntimePlatform().toLowerCase();

const disposeNativeNavigationIntents = subscribeToNativeNavigationIntents();
const disposeAndroidSystemBars = subscribeAndroidSystemBars();
if (import.meta.hot) import.meta.hot.dispose(disposeNativeNavigationIntents);
if (import.meta.hot) import.meta.hot.dispose(disposeAndroidSystemBars);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <ReviewBanner/>
      <App />
    </AppProvider>
  </React.StrictMode>
);
