import React from 'react';
import { createRoot } from 'react-dom/client';
import AgentApp from './AgentApp';
import './styles/agent.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgentApp />
  </React.StrictMode>,
);
