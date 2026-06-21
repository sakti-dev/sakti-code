import { Route, Router } from "@solidjs/router";
import "./index.css";
import { render } from "solid-js/web";
import Home from "./pages/home";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Root element #app not found");
}

render(
  () => (
    <Router>
      <Route component={Home} path="/" />
    </Router>
  ),
  root
);
