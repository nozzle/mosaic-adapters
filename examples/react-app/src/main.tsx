// This file is the main entry point for the application. It performs the initial, one-time
// setup for Mosaic's global coordinator and then bootstraps the root React component (`<App />`).
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import * as vg from "@uwdata/vgplot";
import './ui/table-styles.css'; // Import the new stylesheet

// Perform the one-time, global Mosaic setup here.
// This configures the coordinator that our React app will later consume.
vg.coordinator().databaseConnector(vg.socketConnector("ws://localhost:3000"));

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);