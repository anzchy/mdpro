import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./styles/themes/light.css";
import "./styles/themes/dark.css";

// Apply macOS traffic-light clearances only when running inside Tauri on macOS.
// Windows/Linux Tauri builds and web preview get the 0-offset defaults.
const isTauri = "__TAURI_INTERNALS__" in window;
const isMacOS = navigator.platform.toUpperCase().includes("MAC") ||
  navigator.userAgent.includes("Mac");
if (isTauri && isMacOS) {
  document.body.classList.add("tauri-macos");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
