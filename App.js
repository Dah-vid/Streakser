// Streaks — habit streak tracker with scheduled habits, auto-freeze, and a
// tactile haptic log button. Runs in Expo Go (real Taptic engine on iPhone).
//
// Setup:
//   npx create-expo-app StreakApp --template blank
//   cd StreakApp
//   npx expo install expo-haptics @react-native-async-storage/async-storage
//   (replace the generated App.js with this file)
//   npx expo start   -> scan the QR with Expo Go on your iPhone

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, TextInput, Animated,
  SafeAreaView, StatusBar, Platform, Alert, AppState,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";

// ---------------- haptics (tweak the feel here) ----------------
const HAPTICS = {
  press: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  logged: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  undo: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
};
const buzz = (fn) => { try { fn(); } catch (e) {} };

// ---------------- date helpers ----------------
function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fromKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function today0() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function hexToRgba(hex, a) {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// Re-renders the app when the calendar day changes (app foregrounded after
// midnight, or left open across midnight). Fixes stale "today".
function useTodayKey() {
  const [tk, setTk] = useState(() => toKey(today0()));
  useEffect(() => {
    const check = () => {
      const now = toKey(today0());
      setTk((prev) => (prev === now ? prev : now));
    };
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check(); });
    const iv = setInterval(check, 60 * 1000);
    return () => { sub.remove(); clearInterval(iv); };
  }, []);
  return tk;
}

const DOW = [
  { n: 1, l: "Mo" }, { n: 2, l: "Tu" }, { n: 3, l: "We" },
  { n: 4, l: "Th" }, { n: 5, l: "Fr" }, { n: 6, l: "Sa" }, { n: 0, l: "Su" },
];
function isScheduled(habit, d) {
  const s = habit.schedule;
  if (!s || s.length === 0 || s.length === 7) return true;
  return s.includes(d.getDay());
}
function scheduleLabel(habit) {
  const s = habit.schedule;
  if (!s || s.length === 0 || s.length === 7) return "Daily";
  return DOW.filter((d) => s.includes(d.n)).map((d) => d.l).join(" ");
}

// ---------------- streak + freeze engine ----------------
// Forward walk from first completion. Completed day (scheduled or bonus)
// -> streak +1, freeze re-arms. Non-scheduled, not done -> rest (neutral).
// Missed scheduled day -> frozen if a freeze is armed, else the streak breaks.
// A freeze only re-arms on a completion, so two missed scheduled days in a
// row can never both be saved.
function computeHabit(habit, tk) {
  const comps = habit.completions || {};
  const keys = Object.keys(comps).filter((k) => comps[k]).sort();
  if (keys.length === 0) return { statuses: {}, streak: 0, ready: true };

  const start = fromKey(keys[0]);
  const statuses = {};
  let streak = 0, armed = true;

  for (let d = new Date(start); toKey(d) <= tk; d = addDays(d, 1)) {
    const k = toKey(d);
    const done = !!comps[k];
    const scheduled = isScheduled(habit, d);
    if (done) { streak += 1; armed = true; statuses[k] = "completed"; }
    else if (!scheduled) { statuses[k] = "rest"; }
    else if (k === tk) { statuses[k] = "pending"; }
    else if (armed) { statuses[k] = "frozen"; armed = false; }
    else { statuses[k] = "missed"; streak = 0; }
  }
  return { statuses, streak, ready: armed };
}

// ---------------- grid layout ----------------
const MIN_WEEKS = 16, MAX_WEEKS = 53, CELL = 13, GAP = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildCols(habit, tk) {
  const t = fromKey(tk);
  const keys = Object.keys(habit.completions || {}).filter((k) => habit.completions[k]).sort();
  let startDate = keys.length ? fromKey(keys[0]) : t;
  if (habit.createdAt) { const c = fromKey(habit.createdAt); if (c < startDate) startDate = c; }
  let gridStart = addDays(startDate, -startDate.getDay());
  const minStart = addDays(t, -7 * (MIN_WEEKS - 1));
  const padded = addDays(minStart, -minStart.getDay());
  if (padded < gridStart) gridStart = padded;
  const capStart = addDays(t, -7 * (MAX_WEEKS - 1));
  const cappedStart = addDays(capStart, -capStart.getDay());
  if (gridStart < cappedStart) gridStart = cappedStart;

  const cols = [];
  let cur = new Date(gridStart);
  while (cur <= t) {
    const col = [];
    for (let r = 0; r < 7; r++) { col.push(new Date(cur)); cur = addDays(cur, 1); }
    cols.push(col);
  }
  return cols;
}

// ---------------- palette ----------------
const C = {
  page: "#0F1115", card: "#181B22", edge: "#23272F",
  empty: "#1E222A", missed: "#3A2C2F", frost: "#7DD3FC",
  text: "#F4F2ED", muted: "#9AA0AB", faint: "#6B7280",
};
const HABIT_COLORS = ["#FB923C", "#34D399", "#A78BFA", "#FB7185", "#FBBF24"];
const NAME_MAX = 40;

function cellStyle(status, color) {
  const base = { width: CELL, height: CELL, borderRadius: 3, marginBottom: GAP };
  if (status === "completed") return { ...base, backgroundColor: color };
  if (status === "frozen") return { ...base, backgroundColor: C.frost, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)" };
  if (status === "rest") return { ...base, backgroundColor: hexToRgba(color, 0.17) };
  if (status === "missed") return { ...base, backgroundColor: C.missed };
  if (status === "pending") return { ...base, backgroundColor: "transparent", borderWidth: 1.5, borderColor: color };
  return { ...base, backgroundColor: C.empty };
}

// ---------------- storage safety ----------------
const STORE_KEY = "streak_habits";
const BACKUP_KEY = "streak_habits_backup";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validate persisted data so a bad payload can never crash the UI or be
// silently replaced. Returns only structurally sound habits.
function validateHabits(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    if (typeof h.id !== "string" || typeof h.name !== "string") continue;
    const habit = {
      id: h.id,
      name: h.name.slice(0, NAME_MAX),
      color: typeof h.color === "string" && /^#[0-9a-fA-F]{6}$/.test(h.color) ? h.color : HABIT_COLORS[0],
      schedule: Array.isArray(h.schedule)
        ? [...new Set(h.schedule.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
        : [0, 1, 2, 3, 4, 5, 6],
      createdAt: typeof h.createdAt === "string" && DATE_RE.test(h.createdAt) ? h.createdAt : toKey(today0()),
      completions: {},
    };
    if (h.completions && typeof h.completions === "object") {
      for (const k of Object.keys(h.completions)) {
        if (DATE_RE.test(k) && h.completions[k]) habit.completions[k] = true;
      }
    }
    out.push(habit);
  }
  return out;
}

// ---------------- demo seed (true first run only) ----------------
function seed() {
  const t = today0();
  const c1 = {};
  for (let i = 49; i >= 0; i--) {
    const k = toKey(addDays(t, -i));
    let done = true;
    if (i === 9) done = false;
    if (i === 21 || i === 22) done = false;
    if (i === 0) done = false;
    if (done) c1[k] = true;
  }
  const c2 = {};
  for (let i = 49; i >= 0; i--) {
    const d = addDays(t, -i);
    if ([1, 2, 4, 5].includes(d.getDay()) && i !== 0) c2[toKey(d)] = true;
  }
  return [
    { id: "h1", name: "Deep work — 1 hr", color: "#FB923C", schedule: [0, 1, 2, 3, 4, 5, 6], createdAt: toKey(addDays(t, -49)), completions: c1 },
    { id: "h2", name: "Gym", color: "#34D399", schedule: [1, 2, 4, 5], createdAt: toKey(addDays(t, -49)), completions: c2 },
  ];
}

// ---------------- heatmap ----------------
function Heatmap({ habit, statuses, dayKey, onToggle }) {
  const cols = useMemo(() => buildCols(habit, dayKey), [habit, dayKey]);
  const ref = useRef(null);

  let lastMonth = -1;
  const labels = cols.map((col) => {
    const m = col[0].getMonth();
    if (m !== lastMonth) { lastMonth = m; return MONTHS[m]; }
    return "";
  });

  return (
    <ScrollView
      horizontal
      ref={ref}
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={() => ref.current && ref.current.scrollToEnd({ animated: false })}
    >
      <View>
        <View style={{ flexDirection: "row", marginBottom: GAP }}>
          {labels.map((l, i) => (
            <Text key={i} style={{ width: CELL, marginRight: GAP, fontSize: 9, color: C.faint }}>{l}</Text>
          ))}
        </View>
        <View style={{ flexDirection: "row" }}>
          {cols.map((col, ci) => (
            <View key={ci} style={{ marginRight: GAP }}>
              {col.map((d, ri) => {
                const k = toKey(d);
                const future = k > dayKey;
                const status = future ? "empty" : statuses[k] || "empty";
                if (future) return <View key={ri} style={cellStyle("empty", habit.color)} />;
                return (
                  <Pressable key={ri} onPress={() => onToggle(k)} hitSlop={2}>
                    <View style={cellStyle(status, habit.color)} />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// ---------------- habit card ----------------
function HabitCard({ habit, dayKey, onToggle, onDelete }) {
  const { statuses, streak, ready } = useMemo(() => computeHabit(habit, dayKey), [habit, dayKey]);
  const doneToday = !!(habit.completions && habit.completions[dayKey]);
  const todayScheduled = isScheduled(habit, fromKey(dayKey));

  let label = "Log today";
  if (doneToday) label = "Logged — tap to undo";
  else if (!todayScheduled) label = "Log bonus";

  const scale = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const plusY = useRef(new Animated.Value(0)).current;
  const plusO = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const [burstPos, setBurstPos] = useState({ x: 0, y: 0 });

  function onPressIn() {
    buzz(HAPTICS.press);
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  }
  function onPressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }).start();
  }
  function onPress(e) {
    const { locationX, locationY } = e.nativeEvent;
    setBurstPos({ x: locationX, y: locationY });
    burst.setValue(0);
    Animated.timing(burst, { toValue: 1, duration: 550, useNativeDriver: true }).start();

    const wasDone = doneToday;
    onToggle(habit.id, dayKey);
    if (!wasDone) {
      buzz(HAPTICS.logged);
      Animated.sequence([
        Animated.timing(pop, { toValue: 1.3, duration: 110, useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 4 }),
      ]).start();
      plusY.setValue(0); plusO.setValue(1);
      Animated.parallel([
        Animated.timing(plusY, { toValue: -26, duration: 720, useNativeDriver: true }),
        Animated.timing(plusO, { toValue: 0, duration: 720, useNativeDriver: true }),
      ]).start();
    } else {
      buzz(HAPTICS.undo);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Delete habit?",
      `"${habit.name}" and its history will be removed. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onDelete(habit.id) },
      ]
    );
  }

  return (
    <View style={{ backgroundColor: C.card, borderColor: C.edge, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 }}>
      {/* header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: habit.color, marginRight: 9 }} />
            <Text style={{ color: C.text, fontWeight: "600", fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{habit.name}</Text>
          </View>
          <Text style={{ fontSize: 11, color: C.faint, marginTop: 4, marginLeft: 19 }}>{scheduleLabel(habit)}</Text>
        </View>
        <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 4 }}>
          <MaterialCommunityIcons name="trash-can-outline" size={18} color={C.faint} />
        </Pressable>
      </View>

      {/* streak + freeze */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", marginBottom: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginRight: 16 }}>
          <MaterialCommunityIcons name="fire" size={26} color={streak > 0 ? habit.color : C.faint} />
          <Animated.View style={{ transform: [{ scale: pop }], marginLeft: 5 }}>
            <Text style={{ fontSize: 38, fontWeight: "800", color: C.text, letterSpacing: -1, textShadowColor: streak > 0 ? hexToRgba(habit.color, 0.45) : "transparent", textShadowRadius: streak > 0 ? 16 : 0 }}>{streak}</Text>
          </Animated.View>
          <Text style={{ fontSize: 11, color: C.muted, marginLeft: 6, marginBottom: 3 }}>day{streak === 1 ? "" : "s"}</Text>
          <Animated.Text style={{ position: "absolute", left: 34, top: -6, fontSize: 14, fontWeight: "800", color: habit.color, opacity: plusO, transform: [{ translateY: plusY }] }}>+1</Animated.Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: ready ? "rgba(125,211,252,0.10)" : "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: ready ? "rgba(125,211,252,0.30)" : C.edge }}>
          <MaterialCommunityIcons name="snowflake" size={12} color={ready ? C.frost : C.faint} />
          <Text style={{ fontSize: 11, color: ready ? C.frost : C.faint, marginLeft: 5 }}>{ready ? "Freeze ready" : "Freeze recharging"}</Text>
        </View>
      </View>

      <Heatmap habit={habit} statuses={statuses} dayKey={dayKey} onToggle={(k) => onToggle(habit.id, k)} />

      {/* tactile log button */}
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
        <Animated.View
          style={{
            overflow: "hidden", marginTop: 14, height: 58, borderRadius: 16,
            alignItems: "center", justifyContent: "center", flexDirection: "row",
            backgroundColor: doneToday ? "transparent" : habit.color,
            borderWidth: 1.5, borderColor: doneToday ? habit.color : "transparent",
            transform: [{ scale }],
            ...(doneToday ? {} : Platform.OS === "ios"
              ? { shadowColor: habit.color, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }
              : { elevation: 6 }),
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: burstPos.x - 75, top: burstPos.y - 75,
              width: 150, height: 150, borderRadius: 999,
              backgroundColor: doneToday ? hexToRgba(habit.color, 0.22) : "rgba(255,255,255,0.5)",
              opacity: burst.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
              transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0, 2.6] }) }],
            }}
          />
          <MaterialCommunityIcons name={doneToday ? "check" : "fire"} size={18} color={doneToday ? habit.color : "#0F1115"} />
          <Text style={{ fontWeight: "800", fontSize: 15, marginLeft: 9, color: doneToday ? habit.color : "#0F1115" }}>{label}</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

// ---------------- add habit ----------------
function AddHabit({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(HABIT_COLORS[0]);
  const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]);

  function toggleDay(n) { setDays((ds) => (ds.includes(n) ? ds.filter((x) => x !== n) : [...ds, n])); }
  function submit() {
    const nm = name.trim().slice(0, NAME_MAX);
    if (!nm || days.length === 0) return;
    onAdd(nm, color, [...days].sort((a, b) => a - b));
    setName(""); setColor(HABIT_COLORS[0]); setDays([0, 1, 2, 3, 4, 5, 6]); setOpen(false);
  }

  if (!open) {
    return (
      <Pressable onPress={() => { buzz(HAPTICS.undo); setOpen(true); }} style={{ paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: C.edge, borderStyle: "dashed", alignItems: "center", justifyContent: "center", flexDirection: "row" }}>
        <MaterialCommunityIcons name="plus" size={16} color={C.muted} />
        <Text style={{ color: C.muted, fontWeight: "600", fontSize: 14, marginLeft: 7 }}>New habit</Text>
      </Pressable>
    );
  }

  const daily = days.length === 7;
  return (
    <View style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.edge, borderRadius: 16, padding: 16 }}>
      <TextInput
        autoFocus value={name} onChangeText={setName} maxLength={NAME_MAX}
        placeholder="e.g. Read 20 pages" placeholderTextColor={C.faint}
        style={{ backgroundColor: C.page, borderWidth: 1, borderColor: C.edge, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, marginBottom: 14 }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ fontSize: 11, color: C.muted, letterSpacing: 1 }}>SCHEDULED DAYS</Text>
        <Pressable onPress={() => setDays(daily ? [] : [0, 1, 2, 3, 4, 5, 6])}>
          <Text style={{ fontSize: 11, color: C.faint }}>{daily ? "Clear" : "Every day"}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", marginBottom: 14 }}>
        {DOW.map((d, i) => {
          const on = days.includes(d.n);
          return (
            <Pressable key={d.n} onPress={() => toggleDay(d.n)} style={{ flex: 1, marginRight: i < DOW.length - 1 ? 6 : 0, paddingVertical: 7, borderRadius: 8, alignItems: "center", borderWidth: 1, borderColor: on ? color : C.edge, backgroundColor: on ? hexToRgba(color, 0.18) : "transparent" }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: on ? color : C.faint }}>{d.l}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", marginBottom: 14 }}>
        {HABIT_COLORS.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: 8, marginRight: 10, backgroundColor: c, borderWidth: 2, borderColor: color === c ? "#fff" : "transparent" }} />
        ))}
      </View>
      <View style={{ flexDirection: "row" }}>
        <Pressable onPress={submit} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: color, alignItems: "center" }}>
          <Text style={{ color: "#0F1115", fontWeight: "800", fontSize: 14 }}>Add habit</Text>
        </Pressable>
        <Pressable onPress={() => setOpen(false)} style={{ paddingVertical: 11, paddingHorizontal: 16, marginLeft: 8, borderRadius: 10, borderWidth: 1, borderColor: C.edge, alignItems: "center" }}>
          <Text style={{ color: C.muted, fontSize: 14 }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Swatch({ color, ring, soft, label }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginRight: 16, marginBottom: 6 }}>
      <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: soft ? hexToRgba(color, 0.17) : color, borderWidth: ring ? 1.5 : 0, borderColor: "rgba(255,255,255,0.5)" }} />
      <Text style={{ fontSize: 11, color: C.faint, marginLeft: 6 }}>{label}</Text>
    </View>
  );
}

// ---------------- app ----------------
export default function App() {
  const [habits, setHabits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadWarning, setLoadWarning] = useState(null);
  const dayKey = useTodayKey();

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw === null) {
          // true first run
          setHabits(seed());
        } else {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
          const valid = validateHabits(parsed);
          if (valid !== null) {
            setHabits(valid);
          } else {
            // Never overwrite user data with the demo. Back it up and start
            // empty so the corrupt payload is preserved for recovery.
            await AsyncStorage.setItem(BACKUP_KEY, raw).catch(() => {});
            setHabits([]);
            setLoadWarning("Saved data couldn't be read. A backup was kept; your habits list has been reset.");
          }
        }
      } catch (e) {
        // Storage unreadable entirely — start empty, don't seed over it.
        setHabits([]);
        setLoadWarning("Couldn't access saved data. Changes made now will overwrite it.");
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(habits)).catch(() => {});
  }, [habits, loaded]);

  function toggle(id, key) {
    setHabits((hs) => hs.map((h) => {
      if (h.id !== id) return h;
      const comps = { ...(h.completions || {}) };
      if (comps[key]) delete comps[key]; else comps[key] = true;
      return { ...h, completions: comps };
    }));
  }
  function addHabit(name, color, schedule) {
    setHabits((hs) => [...hs, { id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, color, schedule, createdAt: dayKey, completions: {} }]);
  }
  function deleteHabit(id) { setHabits((hs) => hs.filter((h) => h.id !== id)); }
  function confirmClearAll() {
    Alert.alert(
      "Clear all habits?",
      "Every habit and its entire history will be deleted. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete everything", style: "destructive", onPress: () => setHabits([]) },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.page, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) : 0 }}>
      <StatusBar barStyle="light-content" backgroundColor={C.page} />
      <ScrollView contentContainerStyle={{ maxWidth: 460, width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 18, paddingBottom: 60 }}>
        <View style={{ marginBottom: 22 }}>
          <Text style={{ fontSize: 11, letterSpacing: 3, color: C.faint, marginBottom: 3 }}>KEEP THE FIRE</Text>
          <Text style={{ fontSize: 27, fontWeight: "800", color: C.text, letterSpacing: -0.5 }}>Streaks</Text>
        </View>

        {loadWarning && (
          <View style={{ backgroundColor: "rgba(251,146,60,0.08)", borderWidth: 1, borderColor: "rgba(251,146,60,0.35)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <Text style={{ color: "#FDBA74", fontSize: 12, lineHeight: 17 }}>{loadWarning}</Text>
          </View>
        )}

        {!loaded ? (
          <Text style={{ color: C.faint, fontSize: 14, textAlign: "center", paddingVertical: 40 }}>Loading…</Text>
        ) : habits.length === 0 ? (
          <View>
            <Text style={{ color: C.muted, fontSize: 14, lineHeight: 21, paddingVertical: 12 }}>No streaks yet. Add a habit, pick the days it runs, and your first square lights up the moment you finish it.</Text>
            <AddHabit onAdd={addHabit} />
          </View>
        ) : (
          <>
            {habits.map((h) => (<HabitCard key={h.id} habit={h} dayKey={dayKey} onToggle={toggle} onDelete={deleteHabit} />))}
            <AddHabit onAdd={addHabit} />
          </>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 24 }}>
          <Swatch color="#FB923C" label="Done" />
          <Swatch color={C.frost} ring label="Frozen" />
          <Swatch color="#FB923C" soft label="Rest" />
          <Swatch color={C.missed} label="Missed" />
          {habits.length > 0 && (
            <Pressable onPress={confirmClearAll} style={{ flexDirection: "row", alignItems: "center", marginLeft: "auto", marginBottom: 6 }}>
              <MaterialCommunityIcons name="refresh" size={12} color={C.faint} />
              <Text style={{ fontSize: 11, color: C.faint, marginLeft: 5 }}>Clear all</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
