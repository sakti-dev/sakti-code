import "./index.css";
import { render } from "solid-js/web";
import WorkspaceLayout from "./components/layout/workspace-layout";
import { ThemeProvider } from "./lib/theme-provider";
import { StoreProvider } from "./stores/store-context";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Root element #app not found");
}

render(
  () => (
    <ThemeProvider initialColorMode="dark">
      <StoreProvider>
        <WorkspaceLayout />
      </StoreProvider>
    </ThemeProvider>
  ),
  root,
);
