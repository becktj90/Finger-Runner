import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { GAME_HTML, STORAGE_KEYS } from "@/constants/gameHtml";

const PERSIST_KEYS = [STORAGE_KEYS.best, STORAGE_KEYS.maxLevel, STORAGE_KEYS.hat];

export default function GameFrame() {
  const [initialStorage, setInitialStorage] = useState<Record<string, string> | null>(
    null,
  );
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const seed: Record<string, string> = {};
      try {
        const pairs = await AsyncStorage.multiGet(PERSIST_KEYS);
        for (const [key, value] of pairs) {
          if (value != null) seed[key] = value;
        }
      } catch {
        // Fall back to empty seed — the game uses its own defaults.
      }
      if (mounted) setInitialStorage(seed);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        key?: string;
        value?: string | null;
      };
      if (msg.type === "persist" && typeof msg.key === "string") {
        if (msg.value == null) {
          void AsyncStorage.removeItem(msg.key);
        } else {
          void AsyncStorage.setItem(msg.key, String(msg.value));
        }
      }
    } catch {
      // Ignore malformed messages from the WebView.
    }
  }, []);

  if (!initialStorage) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#ffd700" size="large" />
      </View>
    );
  }

  const seedScript = `window.__INIT_STORAGE__ = ${JSON.stringify(initialStorage)}; true;`;

  return (
    <WebView
      ref={webRef}
      style={styles.webview}
      originWhitelist={["*"]}
      source={{ html: GAME_HTML }}
      injectedJavaScriptBeforeContentLoaded={seedScript}
      onMessage={onMessage}
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      setBuiltInZoomControls={false}
      androidLayerType="hardware"
      textZoom={100}
    />
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: "#87CEEB" },
  loading: {
    flex: 1,
    backgroundColor: "#0a0a22",
    alignItems: "center",
    justifyContent: "center",
  },
});
