/* @refresh reload */
import App from "@/routes";
import { registerDefaultPartComponents } from "@/views/workspace-view/chat-area/parts/register-parts";
import { render } from "solid-js/web";
import "./assets/main.css";

// Enable dark mode by default
document.documentElement.classList.add("dark");
registerDefaultPartComponents();

// Get server config from preload
const getServerConfig = async () => {
  try {
    const config = await window.saktiCodeAPI.server.getConfig();
    return config;
  } catch (error) {
    console.error("Failed to get server config:", error);
    return { baseUrl: "http://127.0.0.1:3000", token: "" };
  }
};

const root = document.getElementById("root");

// Initialize app with server config
getServerConfig().then(config => {
  render(() => <App config={config} />, root!);
});
