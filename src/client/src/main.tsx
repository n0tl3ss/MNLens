import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./sharedUi.css";
import "./reviewInsights.css";
import "./markdown.css";
import "./darkTheme.css";
import "./responsive.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
