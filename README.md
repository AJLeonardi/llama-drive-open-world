# Llama Drive: Open World

An open-world driving and crashing game for kids, built for an iPad (landscape) as a web app.
Pick a car, drive between a Boston-ish city and a New York-ish city on the highway, smash
things, jump the dirt track, loop the loop, and wreck the car.

- **Cars:** 2025 Ford Bronco Badlands (Sasquatch), Lamborghini Aventador, Jeep Wrangler (top off).
- **Damage:** dents, falling-off parts, cracked glass, and smoke. It scales with speed and car size, adds up over time, and the car eventually stops working.
- **Places:** the two cities, the highway, a dirt track with a jump and a loop, a demolition park, bridges, and the river. Drive into the water and you'll meet some fish before restarting.
- **Sound:** generated live from each car's real engine layout (turbo V6, V12, plain V6), plus crash sounds by material.
- **Content:** no people other than the player, and no gore.

## Controls

| Touch | Keyboard |
|---|---|
| ◀ ▶ (bottom left) steer | ← → or A D |
| GAS (bottom right) | ↑ or W |
| BACK (bottom right): brakes, then reverses | ↓ or S |
| 🎥 cycles cockpit / chase / orbit camera | C |
| 🚗 garage menu: keep driving, new car, start over, sound | Esc |
| "Flip me over!" appears if the car is stuck on its roof | F |

In orbit view, drag on the screen to look around the car.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, also on your Wi-Fi so an iPad can open it
npm test           # physics, damage, layout and loop tests (headless)
npm run build      # typecheck + production build into dist/
```

The FPS / draw-call overlay and crash logging are **on by default** for now (device testing). Add `?debug=0` to the URL to hide them.

## Put it on the iPad

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. In the repo's
Settings → Pages, set **Source: GitHub Actions** once. Then open the site in Safari on the iPad,
tap **Share → Add to Home Screen**, and launch it from the home screen. It runs full-screen
and keeps working offline.
