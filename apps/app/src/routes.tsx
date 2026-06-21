import {
  ColorModeProvider,
  ColorModeScript,
  createLocalStorageManager,
} from "@kobalte/core";
import { Route, Router } from "@solidjs/router";
import "./index.css";
import { render } from "solid-js/web";
import AppShell from "./components/layout/app-shell";
import Home from "./pages/home";
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
          <Router>
            <Route component={AppShell} path="/">
              <Route component={Home} path="/" />
            </Route>
          </Router>
        </StoreProvider>
      </ColorModeProvider>
    </>
  ),
  root
);
