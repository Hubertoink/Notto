# NOTO Logo Reveal

Three-second, silent 1920 × 1080 / 60 fps logo reveal, built and rendered with HyperFrames 0.8.169. Source composition: `index.html`, ID `noto-logo-reveal`.

The exact `public/noto-bauhaus.svg` paths and brand colors are preserved. The Noto application's Arial Bold wordmark is stored as four vector outlines; no font file needs to be distributed. GSAP is bundled locally in `assets/gsap.min.js` with its original license header. Registry `logo-outro`, `bottom-up-letters` and `shimmer-sweep` supplied the assembly, stagger and sweep patterns, adapted to the specific brand geometry.

## Use

From this directory:

```powershell
npm ci
npm run check
npm run dev -- --background --port 3027
npm run render
node scripts/package-delivery.mjs
npx playwright install chromium
node scripts/check-delivery.mjs
```

The wrapper selects full FFmpeg/FFprobe binaries from the project dependencies, avoiding the audio-only Windows app alias. Other Noto app dependencies are unaffected.

Delivery files are checked into `delivery/`: MP4, VP9 WebM, PNG poster, decoded frame strip, browser preview, and verification report. A muted inline video using WebM then MP4 is suitable for a website; `delivery/preview.html` demonstrates playback and reduced-motion handling. `loop` is optional. The loop fades to matching black frames; for a loading splash, remove the overlay when the app is ready rather than delaying navigation for playback.

## Timing

| Time | Action |
| --- | --- |
| 0.04–1.10 s | Original square, circle and triangle assemble from three directions |
| 1.10–1.42 s | Restrained clipped light pulse |
| 1.42–2.02 s | Four letters rise and fade in left to right |
| 2.02–2.62 s | Still, readable lockup |
| 2.62–2.96 s | Whole lockup fades gently to matte black |

## Verification

HyperFrames check passed with 25 timeline samples, zero runtime, layout or motion errors. One reviewed structural warning recommends subcompositions; this single three-second scene is intentionally monolithic. Seven motion assertions verify staged visibility, assembly-before-wordmark and in-frame placement. Contrast audit reports 0 text checks because lettering is outlined SVG, so visual inspection is required.

Proof snapshots inspected at 0, 0.35, 0.70, 1.10, 1.26, 1.72, 2.20 and 2.98 seconds, plus a focused red-circle trajectory. Decoded MP4 frames and final lockup inspected after export. FFprobe confirms exactly 180 frames, 3.000 seconds, 1920 × 1080 and 60 fps. First and last decoded MP4 frames are pixel-identical. Render used hardware GPU screenshot capture. No audio, particles, lens flares or camera animation.
