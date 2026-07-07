import "./index.css";
import { Game } from "./game/game";

const root = document.getElementById("root");
if (root) {
  const game = new Game(root);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => game.destroy());
  }
}
