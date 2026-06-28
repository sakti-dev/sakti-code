import { render } from "solid-js/web";
import { Velomark } from "velomark";
import "velomark/styles.css";

render(
  () => (
    <Velomark
      markdown={"# Packed Consumer\n\nParagraph with **strong** and `code`."}
    />
  ),
  document.getElementById("root") as HTMLElement
);
