import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UpdateToast } from "./components/UpdateToast";
import { initPwa } from "./pwa";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <UpdateToast />
  </StrictMode>,
);

initPwa();
