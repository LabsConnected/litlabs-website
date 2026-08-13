import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Easing } from "react-native";

export type OrbState = "idle" | "listening" | "thinking" | "working" | "success" | "approval" | "glitch";

interface LiTTOrbProps {
  state: OrbState;
  micLevel?: number; // 0 to 1
  size?: number;
}

export function LiTTOrb({ state, micLevel = 0, size = 120 }: LiTTOrbProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation
    let pulseSpeed = 2000;
    if (state === "working") pulseSpeed = 800;
    if (state === "thinking") pulseSpeed = 1200;

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: pulseSpeed,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.95,
          duration: pulseSpeed,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();

    // Rotation animation
    const rotateLoop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: state === "working" ? 2000 : 6000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    rotateLoop.start();

    return () => {
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, [state, pulseAnim, rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const getOrbColor = () => {
    switch (state) {
      case "listening":
        return "#3b82f6";
      case "thinking":
        return "#8b5cf6";
      case "working":
        return "#06b6d4";
      case "success":
        return "#10b981";
      case "approval":
        return "#f59e0b";
      case "glitch":
        return "#ef4444";
      case "idle":
      default:
        return "#6366f1";
    }
  };

  const color = getOrbColor();
  const dynamicSize = size + (state === "listening" ? micLevel * 30 : 0);

  return (
    <View style={[styles.container, { width: dynamicSize, height: dynamicSize }]}>
      <Animated.View
        style={[
          styles.glowRing,
          {
            width: dynamicSize + 20,
            height: dynamicSize + 20,
            borderRadius: (dynamicSize + 20) / 2,
            backgroundColor: color,
            opacity: 0.2,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.outerRing,
          {
            width: dynamicSize,
            height: dynamicSize,
            borderRadius: dynamicSize / 2,
            borderColor: color,
            transform: [{ rotate: spin }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.core,
          {
            width: dynamicSize * 0.6,
            height: dynamicSize * 0.6,
            borderRadius: (dynamicSize * 0.6) / 2,
            backgroundColor: color,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",
    alignItems: "center",
  },
  glowRing: {
    position: "absolute",
  },
  outerRing: {
    position: "absolute",
    borderWidth: 2,
    borderStyle: "dashed",
  },
  core: {
    position: "absolute",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 10,
  },
});
