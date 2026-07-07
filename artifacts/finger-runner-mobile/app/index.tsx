import { StatusBar } from "expo-status-bar";
import React from "react";
import { StyleSheet, View } from "react-native";

import GameFrame from "@/components/GameFrame";

export default function GameScreen() {
  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <GameFrame />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#87CEEB" },
});
