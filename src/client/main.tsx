import { createRoot } from "react-dom/client";
import { ConfigProvider } from "./config";
import App from "./App";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <ConfigProvider>
    <App />
  </ConfigProvider>,
);
