import React from 'react';
import { createRoot } from 'react-dom/client';
import Entry from './Entry';
import './styles/agent.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Entry />
  </React.StrictMode>,
);
