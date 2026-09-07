# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** AnyTools
**Generated:** 2026-05-28 11:55:51
**Category:** Developer Tool / IDE

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#475569` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#64748B` | `--color-secondary` |
| Accent/CTA (brand) | `#047857` light / `#10B981` dark | `--color-accent` |
| Brand gradient | `#10B981` → `#06B6D4` (emerald→cyan) | `--color-brand-from/to` |
| Background | `#F8FAFC` | `--color-background` |
| Foreground | `#1E293B` | `--color-foreground` |
| Muted | `#EAEFF3` | `--color-muted` |
| Border | `#E2E8F0` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| Ring | `#047857` light / `#10B981` dark | `--color-ring` |

**Color Notes:** Neutral slate chrome + **emerald brand accent** (deep emerald-700 in light for WCAG AA, vivid emerald-500 in dark). Brand-only emerald→cyan gradient for logo + hero. Per-cluster accent hues stay distinct from the brand accent.

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Mood:** minimal, clean, swiss, functional, neutral, professional
- **Google Fonts:** [Inter + Inter](https://fonts.google.com/share?selection.family=Inter:wght@300;400;500;600;700)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary CTA Button (brand accent = emerald) */
.btn-primary {
  background: #047857;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #475569;
  border: 2px solid #475569;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #F8FAFC;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #475569;
  outline: none;
  box-shadow: 0 0 0 3px #47556920;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Dark Mode (OLED)

**Keywords:** Dark theme, low light, high contrast, deep black, midnight blue, eye-friendly, OLED, night mode, power efficient

**Best For:** Night-mode apps, coding platforms, entertainment, eye-strain prevention, OLED devices, low-light

**Key Effects:** Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus

### Page Pattern

**Pattern Name:** FAQ/Documentation Landing

- **Conversion Strategy:** Reduce support tickets. Track search analytics. Show related articles. Contact escalation path.
- **CTA Placement:** Search bar prominent + Contact CTA for unresolved questions
- **Section Order:** 1. Hero with search bar, 2. Popular categories, 3. FAQ accordion, 4. Contact/support CTA

---

## Tool UI Layout Contract

> **Scope:** every `packages/anytools-tools/src/<slug>/ui.tsx` and its sibling modules.
> Added 2026-09-07 (plan `plans/260906-1735-tool-ui-upgrade-per-tool`, Phase 1).
>
> **Why this exists:** the UI upgrade calls `ak:ui-ux-pro-max` roughly 120 times, once per tool.
> That skill is a style/palette/typography database, so 120 unguided calls produce 120 locally
> plausible and mutually inconsistent layouts. **Pass this section into every call, together with
> the sentence: "design tokens are locked — do not propose palettes or fonts."**

### Source of truth

`packages/ui/src/styles/globals.css` is authoritative for every token. This file is a copy for
humans. If the two disagree, the CSS is right and this file is stale.

### Section order (top to bottom)

1. **Title + one-line description** — only when the tool page does not already render them.
2. **Input** — the thing the user acts on: textarea, dropzone, or the primary field.
3. **Options** — secondary controls, below the input, never above it.
4. **Action row** — primary button, then `Try example`, then `Clear`, left to right.
5. **Output** — label row (uppercase, `text-xs tracking-wide text-muted-foreground`) with
   `CopyButton` right-aligned, then the result surface.
6. **Footer notes** — `PrivacyNote`, disclaimers, cross-links.

**One exception, and it is load-bearing:** a warning about what the user is *about to* paste goes
**above** the input. A warning placed after the paste is useless. `curl-converter` is the worked
example.

### Spacing

| Where | Class |
|---|---|
| Between major sections | `space-y-6` |
| Within a section | `space-y-4` |
| Between related controls | `space-y-3` |
| Inline gaps (button rows, chips) | `gap-2` |
| Card padding | inherited from `CardContent`, do not override |

### Controls — use the primitive, never the native element

| Need | Use | Never |
|---|---|---|
| Choose one from a list | `Select` | `<select>` |
| Choose many | `Checkbox` | `<input type="checkbox">` |
| Choose one, ≤4 visible options | `RadioGroup` or `SegmentedControl` | `<input type="radio">` |
| Toggle a mode on/off | `Switch` *(added in Phase 3, `base64-encode` is the pilot)* | a checkbox pretending to be a toggle |
| Numeric range | `RangeSlider` | `<input type="range">` |
| Colour | `ColorInput` | `<input type="color">` |
| Files | `MultiFileDropzone` (`multiple={false}` for single-file tools) | `<input type="file">` |
| Label | `Label` | a bare `<span>` next to an input |

Every control needs a programmatic label — `Label` + `htmlFor`, or `aria-label`. Every tappable
target is ≥44px.

### Affordances — when each one appears

| Affordance | Rule |
|---|---|
| `CopyButton` | Any output the user would plausibly paste elsewhere. |
| `Try example` | Any tool whose input format is not self-evident. Uses `ui.tryExample`. |
| `PrivacyNote` | **Only** tools that genuinely run entirely in the browser. |

**`PrivacyNote` carve-outs — never add it to these:**

- `curl-converter` — POSTs the pasted command, which routinely carries an
  `Authorization: Bearer` header, to the server. Keeps its own `serverNote`, above the input.
- `currency-converter` — calls `/api/fx`.

Its default text is *"Runs entirely in your browser. Your input never leaves your device."*
Putting that on a tool that sends data is a false claim, not an inconsistency.

**Never replace `<PrivacyNote message={s.something} />` with a bare `<PrivacyNote />`.** The
message form carries a tool-specific warning; the bare form silently downgrades it to the generic
sentence while leaving `strings.ts` untouched, so nothing catches it. `rsa-keypair-generator`
("do not use browser-generated keys for high-value production systems") is the worked example.

### Which container a tool uses

Decided in Phase 1 after auditing the generators cluster; recorded so later phases do not
re-litigate it per tool.

| Shape | Container |
|---|---|
| One form → one text output | `GeneratorTemplate` |
| Source ↔ target, two panes | `ConverterTemplate` |
| Numeric inputs → a headline figure | `CalculatorTemplate` |
| Anything else | `Card`, laid out per the section order above |

`GeneratorTemplate` takes a single `output: string` and renders one copy button, so it does not
fit — and must not be forced onto — tools with **several outputs** (`hash-generator` shows up to
five hashes, each with its own copy), an **image output plus a download** (`qr-code-generator`,
`barcode-generator`), or **two distinct modes** (`bcrypt-generator` hashes and verifies).

So a cluster carrying more than one container is expected, not a defect. What must stay uniform
inside a cluster is the **section order, spacing and affordances** above — not the wrapper.

### "Try example" is a paste-tool affordance

It belongs on tools where the user supplies a payload whose shape is not obvious: beautifiers,
decoders, regex, jq. All ten current users are that kind of tool.

It does **not** belong on generators. They take structured options that already have working
defaults and produce output immediately, and where they do accept a value —
`qr-code-generator`, `barcode-generator`, `meta-tag-generator` — a placeholder and a
format-specific hint sit next to the field and say the same thing without a button. Its absence
across all twelve generators is the rule applied correctly, not a gap.

### Content that looks like chrome but is not

Delete none of the following while restyling:

- `type="password"` and its `autoComplete` hint.
- Any string key matching `privacy` or `warning*` — a key that stops being *referenced* is a lost
  warning even though the string table still contains it.
- Teardown state: camera generation counters, `AbortController`s, worker `terminate()` calls in
  `useEffect` cleanup, and guard constants such as `MIN_CROP_PX` or `PREVIEW_MAX_SIDE`.

---

## Anti-Patterns (Do NOT Use)

- ❌ Light mode default
- ❌ Slow performance

### Sanctioned Brand-Motion Exceptions (brand surfaces only)

The "minimal glow / sparing animation" rules are **intentionally relaxed** for these brand surfaces (and nowhere else):
- ✅ Morphing-module **logo** animation (load + hover)
- ✅ Hero **emerald aurora glow** backdrop + gradient headline
- ✅ Subtle emerald glow on **primary buttons + ⌘K** trigger

All gated by `prefers-reduced-motion: reduce`. Do **not** apply motion/glow to cluster or tool-page chrome — those stay Swiss-clean.

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
