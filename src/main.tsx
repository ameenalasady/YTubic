import React from "react";
import ReactDOM from "react-dom/client";
import { LazyMotion } from "motion/react";
import App from "./App";
import "./index.css";
// Applies the Interface font setting to <html> in both windows.
import "./lib/interface-font";

// Suppress the WebView2 / Chromium native right-click menu (Back,
// Refresh, Save as, Inspect, …). Our Radix ContextMenu triggers run
// their own `preventDefault` first to open custom menus, so this
// global handler only fires for clicks on areas without a custom menu.
// DevTools stay reachable via F12 / Ctrl+Shift+I.
window.addEventListener("contextmenu", (e) => e.preventDefault());

// Components use the slim `m.*` elements; the animation features load as a
// separate chunk. `strict` throws if a full `motion.*` sneaks back in.
const loadMotionFeatures = () =>
  import("./lib/motion-features").then((mod) => mod.default);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LazyMotion features={loadMotionFeatures} strict>
      <App />
    </LazyMotion>
  </React.StrictMode>,
);
