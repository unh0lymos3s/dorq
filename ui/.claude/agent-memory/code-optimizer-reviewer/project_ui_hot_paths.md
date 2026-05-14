---
name: project-ui-hot-paths
description: dorq UI uses inline React style props throughout — review must hoist static styles to module scope and avoid per-render onFocus/onBlur handlers
metadata:
  type: project
---

The dorq UI deliberately uses inline `style={{...}}` props instead of a CSS-in-JS library or styled classnames (the index.css only has 3-4 utility classes). Frontend perf reviews here should always look for:

1. **Style objects rebuilt on every render** — hoist to module scope constants whenever the style is fully static. For styles that depend on one boolean, prefer two pre-built constants (`STYLE_ON` / `STYLE_OFF`) over a `useMemo`.
2. **`onFocus`/`onBlur` that toggle `borderColor`** — replace with `.dorq-input:focus` / `.dorq-select:focus` rules in `index.css`. The classes already exist after the 2026-05-14 optimization pass.
3. **`onMouseEnter`/`onMouseLeave` for hover** — always use CSS `:hover` instead; React event handlers are wasteful for purely visual state.
4. **Base64 charts in `BacktestResult.charts`** — these are hundreds of KB each. `<img>` tags need `loading="lazy"` and `decoding="async"`, and the `data:image/png;base64,${b64}` strings should be `useMemo`'d so unrelated re-renders don't re-concat them.

**Why:** the four-step wizard layout means typing in step 2's API-key input was previously causing all sibling cards (and their style objects) to re-evaluate on every keystroke. The single ~700-line module-scope hoisting fix was high-leverage.

**How to apply:** when reviewing any new step component or modification to the existing ones, scan for inline style objects inside the JSX body — they should almost always live at module scope or come from a `useMemo`. See [[ui-step-style-hoisting-pattern]] for the structure.
