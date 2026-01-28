import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./styles/themes/light.css";
import "./styles/themes/dark.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
