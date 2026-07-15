import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The hub itself needs no service worker. Returning visitors from the old
// root-hosted game may still carry a root-scoped SW (finger-runner-v2) that
// could serve stale content at play.beckify.com — unregister just that one.
// The game's own SW (scope /scooter/) is left untouched.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      for (const r of regs) {
        if (r.scope === location.origin + "/") r.unregister();
      }
    })
    .catch(() => {});
}
