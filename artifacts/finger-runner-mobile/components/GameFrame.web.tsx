import React from "react";

import { GAME_HTML } from "@/constants/gameHtml";

export default function GameFrame() {
  return (
    <iframe
      title="Finger Runner"
      srcDoc={GAME_HTML}
      style={{
        border: "none",
        width: "100%",
        height: "100%",
        display: "block",
        backgroundColor: "#87CEEB",
      }}
    />
  );
}
