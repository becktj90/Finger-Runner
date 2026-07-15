import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for PWA support
if ("serviceWorker" in navigator) {
  // If a service worker already controls this page (returning visitor), a
  // controllerchange means a freshly-deployed SW just took over — reload once
  // so the user immediately sees the new build instead of a stale cached one.
  if (navigator.serviceWorker.controller) {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
  window.addEventListener("load", () => {
    // Base-relative so the SW registers under the app's own path (e.g. /scooter/
    // when the game is embedded in the beckify hub) with a matching scope,
    // instead of grabbing the site root.
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => reg.update())
      .catch(() => {
        // silent fail — offline mode not critical
      });
  });
}
