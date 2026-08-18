repo: pixel-point/toolcraft
branch: main
path: starter/src/toolcraft

## Last sync
date: 2026-08-17T07:12:15Z

### Updated in this project
- Re-skinned `Beat Studio.dc.html` onto the real Toolcraft token system read from the starter.
- Adopted Toolcraft colors verbatim: pure-black background, `oklch(0.205 0 0)` cards, `#0c8ce9` accent, `#70b0fa` link, `oklch(0.311 0.013 279.19)` border with the `color-mix(… 12%, transparent)` hairline pattern.
- Adopted Inter Variable, the 11/12/13/14px type scale, the 2/4/6/8/12px radius scale, and 4px pill scrollbars.
- Rebuilt sliders as Toolcraft sliders (1px hairline track, 9px square accent thumb, hover markers) and switches at 28×16 with a 14px thumb.

## Screen map
| Screen | Repo files |
|---|---|
| Beat Studio.dc.html — tokens, type, radii, scrollbars | starter/src/styles.css |
| Beat Studio.dc.html — panel/card grammar, hairlines | starter/src/toolcraft/ui/styles.css, starter/src/toolcraft/ui/components/panel/panel-section.tsx |
| Beat Studio.dc.html — volume + EQ sliders | starter/src/toolcraft/ui/components/primitives/slider/slider-parts.tsx |
| Beat Studio.dc.html — switches | starter/src/toolcraft/ui/components/primitives/switch.tsx |
| Beat Studio.dc.html — segmented / bank / take buttons | starter/src/toolcraft/ui/components/primitives/toggle.tsx, .../primitives/selection-state.ts |
| Beat Studio.dc.html — label styles | starter/src/toolcraft/ui/components/primitives/field.tsx, .../primitives/label.tsx |

## Sync history
### 2026-08-17T06:23:47Z — ibrahimweng/3d-mockup-project @ main
Browsed the user's repo; it contained only `LICENSE`, so `Beat Studio.dc.html` was built from scratch with no upstream UI to recreate.
