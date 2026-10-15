# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Llama Drive: Open World — a three.js + Rapier (WASM) web game (PWA) for two 7-year-olds, played in landscape on a
**2017 iPad Pro 10.5" (A10X, iPadOS 17 max — WebGL2, no WebGPU)** and an iPhone. Everything visual and
audible is generated in code: no model, texture or audio files. The visual quality bar is high (PBR
paint, shadows, sculpted cars), but it must still run on the A10X. Content rules: no gore, and no
people other than the player (parked cars are empty).

## Commands

```bash
npm run dev                         # Vite dev server (host: true, so LAN devices can connect)
npm test                            # vitest, headless (Rapier runs in Node)
npx vitest run tests/loop.test.ts   # a single test file
npx vitest run -t "wrangler"        # tests matching a name
npm run typecheck                   # tsc --noEmit
npm run build                       # typecheck + vite build → dist/ (deployed by .github/workflows/deploy.yml)
node scripts/make-icons.mjs         # regenerate public/icon-*.png
```

Debug mode is **on by default** for now (device testing); `?debug=0` turns it off. It shows an
FPS/draw-call/triangle overlay, logs `[crash]` impacts and `[perf]` world build time, and exposes
`window.__game` for poking at the running game from the console. The title screen shows the build number (git commit count, injected in `vite.config.ts`; CI fetches full history for it).

## Architecture

- **Map layout.** The four places sit around a circle a few seconds' drive apart (Boston west, NYC east, dirt track north, demolition park south) with Thunder Mountain on the north-east outskirts. The city street plans and the park/track contents are authored in their original coordinates and shifted into place (`bostonX`, `nycX`, local `X`/`Z` helpers). Each city has a ring road and every street ends on another road; `tests/layout.test.ts` enforces that.
- **`src/game/Game.ts`** owns everything: renderer, scene, state machine (`title → select → drive ⇄ paused`, `wrecked`, `sinking`), a fixed 60 Hz physics loop with render interpolation, crash routing, and adaptive quality (shadow tier and pixel ratio). Restarting replaces the car mid-frame, so `checkState` returns true and `simulate` must stop using the old car (it's freed in WASM; touching it poisons Rapier).
- **Sim vs. view split.** `vehicles/VehicleSim.ts` is pure Rapier (raycast vehicle, drive/coast/drag forces, surfaces, boost, loop assists) and is tested headlessly through `tests/helpers.ts:makeTestbed`. `vehicles/Vehicle.ts` adds the visual `CarModel`, damage, the gearbox (sound only) and interpolation. Keep three.js/DOM out of the sim, layout and damage math so the tests keep running in Node.
- **World data vs. world building.** `world/layout.ts` is the map as plain data plus queries (`heightAt`, `surfaceAt`, `roadAt`, `nearRoad`, `waterDepth`, `isDeepWater`). Physics, the builders and the tests all share it. `world/World.ts` assembles terrain (a Rapier heightfield on the same 8 m grid as the mesh), roads, sidewalks, bridges, the cities (`boston.ts`, `nyc.ts`, `landmarks.ts`), the highway and exit ramps, the dirt track, the demolition park, Thunder Mountain (`mountain.ts`; its shape is terrain from `layout.ts:mountainHeight`) and the city stunt buildings (`cityStunts.ts`: parking garages, skyramps, Beacon Hill). Terrain steeper than ~25° is coloured as rock.
- **Exploding barrels** (`tnt` props, `tntPyramid`): a car bump calls `Breakable.explode`, which throws nearby props and lights fuses on nearby barrels (chain reactions); `Breakable.onBlast` lets `Game.blast` add the fireball, boom, shake and the launch on the car (only the first blast in a chain launches it fully).
- **Draw-call budget.** Static geometry goes through `world/batch.ts:StaticBatch`, merged per 400 m tile and per material key (keys such as `ground`, `plain`, `win-<style>`, `road-<kind>` map to materials in `World.ts`). Props are `InstancedMesh`es per kind and tile (`damage/Breakable.ts`). Distant tiles are hidden.
- **Physics streaming.** Props and parked cars only get Rapier bodies within ~150 m of the player and lose them beyond ~210 m once at rest (`Breakable.stream`, `ParkedCar.activate/deactivate`). Thousands of idle bodies cost several ms per step, even when sleeping. Static colliders (buildings, sidewalks) stay permanently.
- **Crashes.** `physics/Impacts.ts` groups Rapier contact-force events per partner over `IMPACT_WINDOW` into one `Impact`. It **caps the impulse at reduced mass × pre-crash closing speed**, because Rapier's force totals include penetration correction and explode for fast or wedged contacts. It needs `tracker.beforeStep()` called before every `physics.step()`. `damage/Damage.ts` holds the pure, unit-tested formulas (car damage from Δv; object damage scaled by car mass, so heavier cars smash harder).
- **Car models.** `vehicles/builders/geo.ts` provides `sculpt()` (smooth lofted bodies from `keyframes`, with wheel-arch cut-outs), `patch()` (doors and hoods cut from the body surface, keeping its normals), and `rbox`/`latheX`/`tube`/`blob`. Every part goes through `ModelBuilder.part()` with a `Finish` (shared PBR materials in `CarModel.ts`). `Deformer.ts` dents geometry in place, capped against the original positions, then recomputes normals.

## Conventions and gotchas

- Axes: +x east, +z south, +y up. **Car local: +z forward, +x is the car's LEFT.** Heading θ faces `(sin θ, cos θ)`. Wheel order: FL, FR, RL, RR.
- Rapier is pinned to **0.19.x**, which is much faster than 0.14 with many colliders. The heightfield is column-major, rows along z, `(nrows+1)*(ncols+1)` heights. `setIndexForwardAxis` is a *setter* (`ctrl.setIndexForwardAxis = 2`).
- Vertex colours must be linear: use `hex()` from `geo.ts`, never raw `/255` values.
- `mergeGeometries` needs consistent attributes. `geo.merge()` indexes non-indexed inputs, and `StaticBatch` normalizes everything to non-indexed position/normal/uv/color.
- The loop-the-loop (`dirtTrack.ts:loopGeometry`) uses clothoid transitions. A Rapier contact-filter hook in `Physics.ts` lets the car's main body box ignore the loop (no nose scraping; the wheels ride it, helped by stick force, stiffer springs, a speed assist and a steering assist in `VehicleSim`), while a smaller cabin "core" box collides only with the loop, so cars can't fall through. `tests/loop.test.ts` covers completing it, rolling back when too slow, and wrong-lane entries; re-run it after any vehicle tuning.
- Breakaway props (`breakaway` speed in `propModels.ts`: poles, hydrants, benches…) snap off when hit faster than that speed; `Game.handleImpact` restores most of the car's speed and caps its damage. Loose props and junk cars only pass 45% of the impulse to car damage.
- Car damage visuals live in `Vehicle.applyImpact`: dents and paint scuffs are computed in each part's own space (`patch()` hoods hang on a pivot and pop open), lights go dark, and the engine bay (`engineBay()`) shows when the hood opens. Buildings use `fx/BuildingDamage.ts` (growing crack/hole decals, chunks, smoke).
- Avoid CSS `backdrop-filter` on HUD elements over the canvas, and avoid per-frame DOM writes (the HUD only writes on change). Both cost real frame time on iPad.
- Measure real performance on the iPad, not in desktop Chrome automation, which caps around 30–40 fps regardless of load.

## Planned next steps (not built yet)

Getting out of the car and taking over parked cars (parked cars would become `Vehicle`s), and
same-Wi-Fi multiplayer over WebRTC with a QR-code handshake (no internet or signaling server).
`Controls.read()` returning a plain `DriveInput` is the seam where a remote player would plug in.
