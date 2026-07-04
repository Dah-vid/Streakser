# Streakser — run on your iPhone

A habit streak tracker with scheduled habits, an auto-freeze that only protects
*scheduled* days (and never two in a row), and a haptic log button.

## Get it on your phone (Expo Go)

You need Node.js on your laptop and the **Expo Go** app on your iPhone (App Store).

```bash
# 1. create a blank Expo project
npx create-expo-app StreakApp --template blank
cd StreakApp

# 2. add the two native modules (expo install picks SDK-matched versions)
npx expo install expo-haptics @react-native-async-storage/async-storage

# 3. replace the generated App.js with the App.js from this folder

# 4. start it
npx expo start
```

Scan the QR code in the terminal with your iPhone camera → it opens in Expo Go.
Press a log button and you'll feel the real Taptic engine.

## Tuning the haptics

All feedback lives in the `HAPTICS` object at the top of `App.js`:

- `press`  — fires the instant you touch the button (medium impact)
- `logged` — fires when a streak logs (success buzz)
- `undo`   — fires when you un-log (light tap)

Swap `Medium` for `Heavy`/`Light`, or drop the `logged` success buzz for a single
crisp impact — it's one line each.

## Notes

- Data is saved on-device with AsyncStorage; it survives app restarts.
- Two demo habits are seeded on first launch ("Deep work" daily, "Gym" Mon/Tue/Thu/Fri).
  Tap **Clear all** to wipe them and start fresh.
- Tap any past square in the grid to backfill or correct a day.

## Next step: a real icon on your home screen

Expo Go runs the app *inside* Expo Go. To get a standalone icon you install once:

```bash
npm install -g eas-cli
eas build -p ios --profile preview
```

This needs an Apple ID. A free one works but the install expires after ~7 days
(rebuild to refresh); a paid Apple Developer account removes that limit. No App
Store review is needed for your own device.

## Hardening changes (v1.0.1)

- **Safe data loading** — saved data is validated on read. If it's ever
  corrupted, the app backs up the raw payload (key `streak_habits_backup`),
  shows a warning banner, and never overwrites your data with the demo seed.
  The demo only appears on a true first run.
- **Midnight rollover fixed** — "today" refreshes when the app is foregrounded
  or once a minute, so streaks/pending state are correct after midnight
  without restarting the app.
- **Confirmations** — deleting a habit and Clear all now require an explicit
  confirm; both are irreversible.
- **Input limits** — habit names are capped at 40 characters.
- **Android status bar** — content no longer renders under the status bar.
