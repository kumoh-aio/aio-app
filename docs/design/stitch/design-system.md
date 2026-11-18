---
name: Academic Intelligence Modern
colors:
  surface: '#f9f9ff'
  surface-dim: '#cfdaf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e7eeff'
  surface-container-high: '#dee8ff'
  surface-container-highest: '#d8e3fb'
  on-surface: '#111c2d'
  on-surface-variant: '#43474d'
  inverse-surface: '#263143'
  inverse-on-surface: '#ecf1ff'
  outline: '#74777e'
  outline-variant: '#c4c6ce'
  surface-tint: '#49607e'
  primary: '#000f22'
  on-primary: '#ffffff'
  primary-container: '#0a2540'
  on-primary-container: '#768dad'
  inverse-primary: '#b0c8eb'
  secondary: '#12629d'
  on-secondary: '#ffffff'
  secondary-container: '#80bdfe'
  on-secondary-container: '#004c7e'
  tertiary: '#001019'
  on-tertiary: '#ffffff'
  tertiary-container: '#002737'
  on-tertiary-container: '#0095c7'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d2e4ff'
  primary-fixed-dim: '#b0c8eb'
  on-primary-fixed: '#001c37'
  on-primary-fixed-variant: '#314865'
  secondary-fixed: '#d0e4ff'
  secondary-fixed-dim: '#9ccaff'
  on-secondary-fixed: '#001d35'
  on-secondary-fixed-variant: '#00497a'
  tertiary-fixed: '#c3e8ff'
  tertiary-fixed-dim: '#78d1ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c68'
  background: '#f9f9ff'
  on-background: '#111c2d'
  surface-variant: '#d8e3fb'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.25rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system drives an AI academic assistant crafted specifically for university engineering and science students. The interface communicates high intellectual rigor paired with effortless accessibility, evoking feelings of academic confidence, dependable mentorship, and stress-free productivity. 

Drawing from modern Korean product design traditions (seen in high-tier platforms like Toss) combined with refined utility minimalism:
- **Tone:** Academic, forward-thinking, reassuring, and playful through structured micro-interactions.
- **Visual Personality:** Crisp white elevations against serene light-slate backdrops, enriched by collegiate navy authority and electric accent highlights.
- **Mascot Integration:** The graduation-capped crow mascot acts as an intelligent co-pilot, surfacing primarily in empty states, AI query responses, proactive reminder banners, and success toasts with warmth rather than distraction.

## Colors

The palette establishes an authoritative academic baseline with collegiate navies while punctuating dynamic AI insights with high-clarity sky blue and luminous gold.

- **Primary (`#0A2540`):** Used for primary high-emphasis buttons, deep contrast headers, and active state emphasis.
- **Secondary / School Blue (`#005B96`):** Official institutional blue representing campus authentication, course portals, and verified academic data badges.
- **Tertiary / Sky Blue (`#00A3D9`):** Reserved for live AI operations, intelligent summarization tags, prompt pills, and real-time generation indicators.
- **Accent Yellow (`#FFD100`):** Semantic accent indicating high-priority assignment deadlines, GPA highlights, mascot crown/cap touches, and key milestone awards.
- **Backgrounds:** Canvas background runs on `#F7FAFC`, while modular elevated cards utilize pure `#FFFFFF`.
- **Text & Borders:** Primary text is `#1E293B` (deep charcoal), secondary text is `#64748B` (slate), and structural hairline strokes utilize `#E2E8F0`.

## Typography

Typography prioritizes optimal Korean and Latin bilingual rendering with strict optical balance. When targeting native iOS/Android environments, `Inter` serves as the primary system fallback complementing `Pretendard` or `Apple SD Gothic Neo`.

- **Korean Line Height Rule:** Maintain a relaxed 1.45–1.55 line height multiplier for multi-line body copy to accommodate Hangul descenders and vowel radicals cleanly.
- **Word Break:** Apply `word-break: keep-all` on all Korean body text and title blocks to prevent awkward single-syllable line wrapping.
- **Tabular Figures:** Timetables, exam countdowns, assignment dates, and credit scores must strictly apply font-variant-numeric: `tabular-nums`.

## Layout & Spacing

Designed for mobile-first native interaction, the layout utilizes an 8pt-based spatial model centered on safe boundaries and edge-to-edge breathing room.

- **Mobile Viewport Structure:** Standard horizontal margin is `16px` (`margin-mobile`), providing maximum surface area on smaller screens, moving up to `20px` (`margin`) on larger phablet devices.
- **Grid Structure:** A 4-column layout is standard for mobile surfaces, transitioning into an 8-column layout on foldable devices and tablets.
- **AI Chat & Feed Spacing:** AI conversation threads maintain `space-sm` (8px) between contiguous user/assistant messages, and `space-md` (16px) between thematic topic transitions. Bottom action bars must pad safe-area-insets with an additional `12px` clearance.

## Elevation & Depth

Visual hierarchy uses ultra-subtle, clean ambient shadows and pure white surfaces against the `#F7FAFC` neutral canvas, eliminating heavy skeumorphic borders.

- **Base Surface:** Flat `#F7FAFC` canvas.
- **Layer 1 (Cards, Chat Bubbles, Grid Cells):** Pure `#FFFFFF` fill with a composite shadow: `0 2px 8px -2px rgba(10, 37, 64, 0.04), 0 1px 2px -1px rgba(10, 37, 64, 0.02)` and a hairline border of `1px solid #E2E8F0`.
- **Layer 2 (Floating Action Buttons, Menus, Modals):** Pure `#FFFFFF` fill with an elevated ambient drop: `0 12px 24px -4px rgba(10, 37, 64, 0.08), 0 4px 8px -2px rgba(10, 37, 64, 0.03)`.
- **AI Highlight Elevation:** AI query containers use a soft inner ambient glow tinted with sky blue: `0 0 0 1px rgba(0, 163, 217, 0.25), 0 4px 12px rgba(0, 163, 217, 0.06)`.

## Shapes

The geometric architecture pairs high-radii card surfaces with fully rounded pills, creating a friendly, touch-optimized visual cadence.

- **Cards & Containers:** `rounded-2xl` (16px) universally applied to course cards, AI answer cards, modal dialogs, and schedule blocks.
- **Pills, Badges & Interactive Chips:** `rounded-full` (9999px) for search bars, tag filter chips, quick prompt recommendations, and status capsules.
- **Inner Micro Elements:** Checkboxes, segmented tabs, and secondary nested item rows utilize `8px` (`rounded-md` equivalent) to retain visual nested hierarchy.

## Components

### Buttons
- **Primary:** Background `#0A2540`, text `#FFFFFF`, height `52px` (mobile touch target), shape `14px` border radius, font `label-lg`. Pressed state applies a scale transform (`0.98`) with a tint of `rgba(255, 255, 255, 0.1)`.
- **AI Smart Action:** Background `#00A3D9`, text `#FFFFFF`, paired with mascot or spark icon, active elevation with soft blue glow.
- **Secondary / Ghost:** Background `#F1F5F9`, text `#0A2540`, zero border, subtle hover/press state `#E2E8F0`.

### Chips & Filter Tags
- **Filter Chips:** Height `36px`, shape `rounded-full`, border `1px solid #E2E8F0`, background `#FFFFFF`, text `#64748B`.
- **Selected State:** Border `1px solid #005B96`, background `#005B96`, text `#FFFFFF`.
- **Quick Prompt Chips:** Height `32px`, background `rgba(0, 163, 217, 0.08)`, border `1px solid rgba(0, 163, 217, 0.2)`, text `#005B96`.

### Cards
- **Standard Card:** Background `#FFFFFF`, border-radius `16px`, padding `16px` to `20px`, border `1px solid #E2E8F0`, subtle shadow.
- **Course & Exam Alert Card:** Left edge accented with a `4px` solid bar (Navy, School Blue, or Accent Yellow according to urgency).
- **AI Mascot Insight Card:** Light gradient surface from `#FFFFFF` to `rgba(0, 163, 217, 0.04)`, containing a header with the crow avatar, contextual prompt suggestion, and inline action button.

### Input Fields
- **Search & AI Prompt Input:** Height `48px` to `54px`, `rounded-full` or `16px` radius, background `#FFFFFF`, border `1px solid #E2E8F0`. 
- **Active / Focused:** Border `1.5px solid #00A3D9`, outer glow `0 0 0 3px rgba(0, 163, 217, 0.15)`. Placeholder color `#94A3B8`.

### Checkboxes & Radio Buttons
- **Checkboxes:** Size `20px` by `20px`, border-radius `6px`. Unchecked: `1.5px solid #CBD5E1`. Checked: fill `#0A2540` with white checkmark.
- **Radio Buttons:** Outer circle `20px`, inner dot `10px` when active with `#005B96`.

### Academic-Specific Additions
- **Timetable Matrix Cell:** Clean slate fill, `8px` inner radius, bold course acronym, muted room number, color-coded top stroke.
- **Mascot Speech Balloon:** Border-radius `16px` with a `6px` triangular bottom-left pip pointing towards the mascot portrait, `#FFFFFF` background with `1px solid #E2E8F0`.