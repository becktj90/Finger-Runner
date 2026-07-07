import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { GAME_HTML, STORAGE_KEYS } from "@/constants/gameHtml";

const PERSIST_KEYS = [
  STORAGE_KEYS.best,
  STORAGE_KEYS.maxLevel,
  STORAGE_KEYS.hat,
  STORAGE_KEYS.coins,
  STORAGE_KEYS.saberOwned,
  STORAGE_KEYS.saber,
  STORAGE_KEYS.character,
];

const PLAYER_ID_KEY = "fingerRunnerPlayerId";

const SYNC_KEYS = new Set<string>([
  STORAGE_KEYS.coins,
  STORAGE_KEYS.saberOwned,
  STORAGE_KEYS.saber,
  STORAGE_KEYS.maxLevel,
  STORAGE_KEYS.best,
]);

const PROTECTED_KEYS = new Set<string>([PLAYER_ID_KEY]);

function getApiBase(): string {
  const extra = Constants.expoConfig?.extra as { apiBase?: string } | undefined;
  return extra?.apiBase ?? "";
}

function generateUuid(): string {
  const hex = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 32; i++) {
    const r = Math.floor(Math.random() * 16);
    if (i === 8 || i === 12 || i === 16 || i === 20) id += "-";
    id += i === 12 ? "4" : i === 16 ? hex[(r & 0x3) | 0x8] : hex[r];
  }
  return id;
}

async function getOrCreatePlayerId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    const id = generateUuid();
    await AsyncStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    return generateUuid();
  }
}

interface SaveSync {
  coins: number;
  ownedSabers: number[];
  equippedSaber: number;
  maxLevel: number;
  bestScore: number;
}

async function fetchCloudSave(playerId: string): Promise<SaveSync | null> {
  const base = getApiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/saves/${playerId}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as SaveSync;
  } catch {
    return null;
  }
}

async function requestLinkCode(playerId: string): Promise<string | null> {
  const base = getApiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/saves/${playerId}/link-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: string };
    return data.code ?? null;
  } catch {
    return null;
  }
}

async function adoptLinkCode(
  code: string,
  myPlayerId: string,
  storage: Record<string, string>,
): Promise<{ ok: boolean; playerId?: string; save?: SaveSync }> {
  const base = getApiBase();
  if (!base) return { ok: false };
  try {
    const body = {
      playerId: myPlayerId,
      coins: parseInt(storage[STORAGE_KEYS.coins] ?? "0", 10) || 0,
      ownedSabers: buildOwnedSabersArray(storage),
      equippedSaber: parseInt(storage[STORAGE_KEYS.saber] ?? "1", 10) || 1,
      maxLevel: parseInt(storage[STORAGE_KEYS.maxLevel] ?? "1", 10) || 1,
      bestScore: parseInt(storage[STORAGE_KEYS.best] ?? "0", 10) || 0,
    };
    const res = await fetch(`${base}/saves/link/${code.trim().toUpperCase()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as SaveSync & { playerId?: string };
    if (!data.playerId) return { ok: false };
    return { ok: true, playerId: data.playerId, save: data };
  } catch {
    return { ok: false };
  }
}

async function pushCloudSave(playerId: string, storage: Record<string, string>): Promise<void> {
  const base = getApiBase();
  if (!base) return;
  try {
    const blob: SaveSync = {
      coins: parseInt(storage[STORAGE_KEYS.coins] ?? "0", 10) || 0,
      ownedSabers: buildOwnedSabersArray(storage),
      equippedSaber: parseInt(storage[STORAGE_KEYS.saber] ?? "1", 10) || 1,
      maxLevel: parseInt(storage[STORAGE_KEYS.maxLevel] ?? "1", 10) || 1,
      bestScore: parseInt(storage[STORAGE_KEYS.best] ?? "0", 10) || 0,
    };
    await fetch(`${base}/saves/${playerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blob),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Network unavailable — local data is still intact.
  }
}

function buildOwnedSabersArray(storage: Record<string, string>): number[] {
  const highest = parseInt(storage[STORAGE_KEYS.saberOwned] ?? "1", 10) || 1;
  const tiers: number[] = [];
  for (let t = 1; t <= highest; t++) tiers.push(t);
  return tiers;
}

function mergeCloudIntoStorage(
  local: Record<string, string>,
  cloud: SaveSync,
): Record<string, string> {
  const merged = { ...local };

  const localCoins = parseInt(local[STORAGE_KEYS.coins] ?? "0", 10) || 0;
  if (cloud.coins > localCoins) {
    merged[STORAGE_KEYS.coins] = String(cloud.coins);
  }

  const cloudHighest = Array.isArray(cloud.ownedSabers) && cloud.ownedSabers.length > 0
    ? Math.max(...cloud.ownedSabers)
    : 1;
  const localHighest = parseInt(local[STORAGE_KEYS.saberOwned] ?? "1", 10) || 1;
  if (cloudHighest > localHighest) {
    merged[STORAGE_KEYS.saberOwned] = String(cloudHighest);
  }

  const localMaxLevel = parseInt(local[STORAGE_KEYS.maxLevel] ?? "1", 10) || 1;
  if (cloud.maxLevel > localMaxLevel) {
    merged[STORAGE_KEYS.maxLevel] = String(cloud.maxLevel);
  }

  const localBest = parseInt(local[STORAGE_KEYS.best] ?? "0", 10) || 0;
  if (cloud.bestScore > localBest) {
    merged[STORAGE_KEYS.best] = String(cloud.bestScore);
  }

  return merged;
}

export default function GameFrame() {
  const [initialStorage, setInitialStorage] = useState<Record<string, string> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [syncVisible, setSyncVisible] = useState(false);
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [linkStatus, setLinkStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");

  const webRef = useRef<WebView>(null);
  const playerIdRef = useRef<string>("");
  const storageRef = useRef<Record<string, string>>({});
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAndSeed = useCallback(async () => {
    const playerId = await getOrCreatePlayerId();
    playerIdRef.current = playerId;

    const seed: Record<string, string> = {};
    try {
      const pairs = await AsyncStorage.multiGet(PERSIST_KEYS);
      for (const [key, value] of pairs) {
        if (value != null) seed[key] = value;
      }
    } catch {
      // Fall back to empty seed.
    }

    const cloud = await fetchCloudSave(playerId);
    const merged = cloud ? mergeCloudIntoStorage(seed, cloud) : seed;

    if (cloud) {
      const changedPairs: [string, string][] = Object.keys(merged)
        .filter((k) => merged[k] !== seed[k])
        .map((k) => [k, merged[k]]);
      if (changedPairs.length > 0) {
        try {
          await AsyncStorage.multiSet(changedPairs);
        } catch {
          // ignore
        }
      }
    }

    storageRef.current = merged;
    setInitialStorage(merged);
  }, []);

  useEffect(() => {
    void loadAndSeed();
  }, [loadAndSeed]);

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current !== null) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      void pushCloudSave(playerIdRef.current, storageRef.current);
    }, 2000);
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          key?: string;
          value?: string | null;
        };
        if (msg.type === "persist" && typeof msg.key === "string") {
          if (PROTECTED_KEYS.has(msg.key)) return;
          if (msg.value == null) {
            void AsyncStorage.removeItem(msg.key);
            delete storageRef.current[msg.key];
          } else {
            void AsyncStorage.setItem(msg.key, String(msg.value));
            storageRef.current[msg.key] = String(msg.value);
            if (SYNC_KEYS.has(msg.key)) {
              schedulePush();
            }
          }
        }
      } catch {
        // Ignore malformed messages from the WebView.
      }
    },
    [schedulePush],
  );

  const openSyncModal = useCallback(async () => {
    setSyncVisible(true);
    if (!syncCode) {
      const code = await requestLinkCode(playerIdRef.current);
      setSyncCode(code ?? "OFFLINE");
    }
  }, [syncCode]);

  const handleLinkCode = useCallback(async () => {
    const code = codeInput.trim().toUpperCase();
    if (code.length !== 6) return;
    setLinkStatus("loading");
    const result = await adoptLinkCode(code, playerIdRef.current, storageRef.current);
    if (result.ok && result.playerId && result.save) {
      try {
        await AsyncStorage.setItem(PLAYER_ID_KEY, result.playerId);
        playerIdRef.current = result.playerId;
        const newStorage = mergeCloudIntoStorage(storageRef.current, result.save);
        const pairs: [string, string][] = Object.entries(newStorage);
        if (pairs.length > 0) await AsyncStorage.multiSet(pairs);
        storageRef.current = newStorage;
      } catch {
        // ignore
      }
      setLinkStatus("ok");
      setSyncCode(null);
      setTimeout(() => {
        setLinkStatus("idle");
        setSyncVisible(false);
        setCodeInput("");
        setInitialStorage(null);
        setReloadKey((k) => k + 1);
        void loadAndSeed();
      }, 1500);
    } else {
      setLinkStatus("err");
      setTimeout(() => setLinkStatus("idle"), 3000);
    }
  }, [codeInput, loadAndSeed]);

  if (!initialStorage) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#ffd700" size="large" />
      </View>
    );
  }

  const seedScript = `window.__INIT_STORAGE__ = ${JSON.stringify(initialStorage)}; true;`;

  return (
    <View style={styles.container}>
      <WebView
        key={reloadKey}
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

      <TouchableOpacity style={styles.syncBtn} onPress={() => { void openSyncModal(); }}>
        <Text style={styles.syncBtnText}>☁</Text>
      </TouchableOpacity>

      <Modal
        visible={syncVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSyncVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSyncVisible(false)}>
          <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>☁ CROSS-DEVICE SYNC</Text>
            <Text style={styles.modalSub}>
              Share your sync code to link progress between web and mobile.
            </Text>

            <View style={styles.codeRow}>
              <Text style={styles.codeLabel}>Your code:</Text>
              <Text style={styles.codeValue}>
                {syncCode === null ? "..." : syncCode}
              </Text>
            </View>

            <Text style={styles.orLabel}>— Link another device's code —</Text>

            <View style={styles.inputRow}>
              <TextInput
                value={codeInput}
                onChangeText={(t) => setCodeInput(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                placeholder="e.g. AB3C7F"
                placeholderTextColor="#444"
                maxLength={6}
                autoCapitalize="characters"
                style={styles.input}
              />
              <TouchableOpacity
                onPress={() => { void handleLinkCode(); }}
                disabled={linkStatus === "loading" || codeInput.length !== 6}
                style={[
                  styles.linkBtn,
                  linkStatus === "ok" && { borderColor: "#00ff88" },
                  linkStatus === "err" && { borderColor: "#ff4444" },
                ]}
              >
                <Text style={[
                  styles.linkBtnText,
                  linkStatus === "ok" && { color: "#00ff88" },
                  linkStatus === "err" && { color: "#ff4444" },
                ]}>
                  {linkStatus === "loading" ? "..." : linkStatus === "ok" ? "✓ LINKED" : linkStatus === "err" ? "✗ FAIL" : "LINK"}
                </Text>
              </TouchableOpacity>
            </View>

            {linkStatus === "ok" && (
              <Text style={[styles.statusMsg, { color: "#00ff88" }]}>
                Progress merged! Reloading game...
              </Text>
            )}
            {linkStatus === "err" && (
              <Text style={[styles.statusMsg, { color: "#ff4444" }]}>
                Code not found. Check and try again.
              </Text>
            )}

            <TouchableOpacity onPress={() => setSyncVisible(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>CLOSE</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: "#87CEEB" },
  loading: {
    flex: 1, backgroundColor: "#0a0a22",
    alignItems: "center", justifyContent: "center",
  },
  syncBtn: {
    position: "absolute", top: 12, left: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1, borderColor: "rgba(0,255,204,0.4)",
    alignItems: "center", justifyContent: "center",
    zIndex: 30,
  },
  syncBtnText: { fontSize: 16, color: "#00ffcc" },
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,10,0.85)",
    alignItems: "center", justifyContent: "center",
    padding: 20,
  },
  modal: {
    width: "100%", maxWidth: 340,
    backgroundColor: "#0d0d1f", borderRadius: 8,
    borderWidth: 1, borderColor: "#00ffcc44",
    padding: 20,
  },
  modalTitle: {
    fontFamily: "monospace", fontSize: 13, color: "#00ffcc",
    letterSpacing: 1, marginBottom: 6, textAlign: "center",
  },
  modalSub: {
    fontFamily: "monospace", fontSize: 10, color: "#555",
    textAlign: "center", marginBottom: 16,
  },
  codeRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginBottom: 16, justifyContent: "center",
  },
  codeLabel: { fontFamily: "monospace", fontSize: 11, color: "#777" },
  codeValue: {
    fontFamily: "monospace", fontSize: 18, color: "#ffd700",
    letterSpacing: 4, backgroundColor: "rgba(255,215,0,0.07)",
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4,
  },
  orLabel: {
    fontFamily: "monospace", fontSize: 10, color: "#333",
    textAlign: "center", marginBottom: 10,
  },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  input: {
    flex: 1, backgroundColor: "#0a0a22", color: "#fff",
    borderWidth: 1, borderColor: "#333", borderRadius: 4,
    paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: "monospace", fontSize: 14, letterSpacing: 3,
  },
  linkBtn: {
    borderWidth: 1, borderColor: "#00ffcc", borderRadius: 4,
    paddingHorizontal: 12, alignItems: "center", justifyContent: "center",
  },
  linkBtnText: {
    fontFamily: "monospace", fontSize: 11, color: "#00ffcc", letterSpacing: 0.5,
  },
  statusMsg: {
    fontFamily: "monospace", fontSize: 10, textAlign: "center", marginBottom: 8,
  },
  closeBtn: {
    marginTop: 10, alignItems: "center", padding: 10,
    borderWidth: 1, borderColor: "#222", borderRadius: 4,
  },
  closeBtnText: { fontFamily: "monospace", fontSize: 11, color: "#444" },
});
