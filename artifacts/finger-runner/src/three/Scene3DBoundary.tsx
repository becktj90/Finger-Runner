// ── Guards the 3D render layer ────────────────────────────────────────────
// If WebGL is unavailable (older browser, disabled GPU, headless test
// sandbox, etc.) Three.js throws while constructing the WebGLRenderer. That
// happens inside <Canvas>'s mount effect, so a React error boundary is the
// only way to stop it from taking down the whole game. Gameplay itself
// (physics/state in Game.tsx) never depends on this render layer, so on
// failure we simply render nothing here — the HUD canvas and DOM overlays
// keep working normally.
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class Scene3DBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("3D scene failed to initialize; continuing without 3D visuals.", error);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
