import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UpdateToast } from "./components/UpdateToast";
import { initPwa } from "./pwa";
import { initSync } from "./store/sync";
import { applyThemeEarly, ThemeSync } from "./theme";
import "./index.css";

applyThemeEarly();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeSync />
    <App />
    <UpdateToast />
  </StrictMode>,
);

initPwa();
initSync();
