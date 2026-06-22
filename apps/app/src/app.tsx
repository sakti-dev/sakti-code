import {
  ColorModeProvider,
  ColorModeScript,
  createLocalStorageManager,
} from "@kobalte/core";
import "./index.css";
import { render } from "solid-js/web";
import WorkspaceLayout from "./components/layout/workspace-layout";
import { StoreProvider } from "./stores/store-context";

const colorModeStorage = createLocalStorageManager("sakti-theme");
const root = document.getElementById("app");
if (!root) {
  throw new Error("Root element #app not found");
}

render(
  () => (
    <>
      <ColorModeScript
        initialColorMode="dark"
        storageType={colorModeStorage.type}
      />
      <ColorModeProvider
        initialColorMode="dark"
        storageManager={colorModeStorage}
      >
        <StoreProvider>
          <WorkspaceLayout />
        </StoreProvider>
      </ColorModeProvider>
    </>
  ),
  root
);
