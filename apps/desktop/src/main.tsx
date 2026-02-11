/* @refresh reload */
import { registerDefaultPartComponents } from "@renderer/components/parts/register";
import { AppProvider } from "@renderer/presentation/providers";
import App from "@renderer/routes";
import { render } from "solid-js/web";
import "./assets/main.css";

// Enable dark mode by default
document.documentElement.classList.add("dark");
registerDefaultPartComponents();

// Get server config from preload
const getServerConfig = async () => {
  try {
    const config = await window.ekacodeAPI.server.getConfig();
    return config;
  } catch (error) {
    console.error("Failed to get server config:", error);
    return { baseUrl: "http://127.0.0.1:3000", token: "" };
  }
};

const root = document.getElementById("root");

// Initialize app with server config and new AppProvider
getServerConfig().then(config => {
  render(
    () => (
      <AppProvider config={config}>
        <App />
      </AppProvider>
    ),
    root!
  );
});
