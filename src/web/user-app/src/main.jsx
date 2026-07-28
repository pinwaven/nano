import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App.jsx';
import './style.css';

// Matches the miniapp's app.js, which hardcodes this same shared bearer token
// on every wx.request call — without it, every non-login /api/* call 401s.
if (import.meta.env.VITE_API_TOKEN) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${import.meta.env.VITE_API_TOKEN}`;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
