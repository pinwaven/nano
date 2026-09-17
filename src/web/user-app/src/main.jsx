import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AppProvider } from './store/AppContext.jsx';
import axios from 'axios';
import './style.css';
import './mini-css/main.css';
import './mini-css/toolbox.css';
import './mini-css/user-health.css';
import './mini-css/health-documents.css';
import './mini-css/viva-ag-panel.css';
import './mini-css/avatar-picker.css';
import './mini-css/phones.css';
import './mini-css/emails.css';
import './mini-css/referral.css';
import './web-overrides.css';

// The shared app bearer (same token the miniapp's app.js hardcodes) is attached per request
// in api.js; the axios default below only serves tabs not yet ported off raw axios.
if (import.meta.env.VITE_API_TOKEN) axios.defaults.headers.common['Authorization'] = `Bearer ${import.meta.env.VITE_API_TOKEN}`;
// StrictMode's double-mount is safe for the notification poll — see the header of
// hooks/useNotificationPoll.js.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
