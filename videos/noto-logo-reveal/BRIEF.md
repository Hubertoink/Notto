---
workflow: motion-graphics
flow: automation
storyboard: no
message: "NOTO — calm, intelligent productivity"
destination: website splash screen
aspect: "16:9"
language: brand-only
length: 3 seconds
---

# NOTO logo reveal

Create the finished video from the user's detailed brief. Use the actual Noto icon from `../../public/noto-bauhaus.svg` and the supplied horizontal logo reference.

## Locked requirements

Matte black background; static, centered composition; clean vector-like edges. The blue square moves in from the left, the red circle from the upper right with restrained inertia, and the yellow triangle rises from below. Movement feels guided by a soft field, never abrupt. When the last shape arrives, a subtle glow pulse passes through the assembled icon. Immediately afterward, NOTO appears letter by letter from left to right with opacity and a small upward movement. Premium, minimal product-launch motion, soft reflections and ambient glow. No particles, lens flares, camera shake or zoom. Exactly three seconds, 16:9, loop-friendly.

## Implementation decisions

- 1920 × 1080, 60 fps, silent MP4 plus a lightweight web version.
- Preserve original SVG geometry and colors: blue #0645ef, red #e63822, yellow #f0c600; warm-white wordmark.
- Use the app's bold Arial letterforms converted to vector paths for deterministic output without shipping a font.
- Assemble first, reveal wordmark second, hold the final lockup, then gently fade to the same matte-black opening state for a clean loop.
- Keep the editable HyperFrames source separate from the production app. A website-ready preview accompanies the video; this request does not require deploying a new app release.

## Assets

Original SVG ingested through HyperFrames media-use into `.media/images/logo_001.svg`. User supplied a visual wordmark reference in chat. No generated imagery or external media required.
