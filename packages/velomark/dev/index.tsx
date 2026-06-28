import { render } from "solid-js/web";
import "./main.css";

import App from "./app";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element for the playground.");
}

render(() => <App />, root);
