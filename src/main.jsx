import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';
import { preloadStatementIcon } from './lib/statement-pdf.js';

// Fetched now so a statement can be built synchronously inside a tap later.
preloadStatementIcon();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
