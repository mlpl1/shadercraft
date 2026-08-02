---
name: Vivid High-Contrast
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1b1b1d'
  surface-container: '#201f21'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e5e1e4'
  on-surface-variant: '#c4c9b5'
  inverse-surface: '#e5e1e4'
  inverse-on-surface: '#303032'
  outline: '#8e9380'
  outline-variant: '#444939'
  surface-tint: '#aed366'
  primary: '#ffffff'
  on-primary: '#243600'
  primary-container: '#c9f07e'
  on-primary-container: '#4f6e04'
  inverse-primary: '#496800'
  secondary: '#b2c5ff'
  on-secondary: '#002b74'
  secondary-container: '#0442a6'
  on-secondary-container: '#9eb6ff'
  tertiary: '#ffffff'
  on-tertiary: '#63013d'
  tertiary-container: '#ffd8e6'
  on-tertiary-container: '#a63e73'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c9f07e'
  primary-fixed-dim: '#aed366'
  on-primary-fixed: '#141f00'
  on-primary-fixed-variant: '#364e00'
  secondary-fixed: '#dae2ff'
  secondary-fixed-dim: '#b2c5ff'
  on-secondary-fixed: '#001848'
  on-secondary-fixed-variant: '#003fa3'
  tertiary-fixed: '#ffd8e6'
  tertiary-fixed-dim: '#ffafd0'
  on-tertiary-fixed: '#3d0024'
  on-tertiary-fixed-variant: '#801f54'
  background: '#131315'
  on-background: '#e5e1e4'
  surface-variant: '#353437'
  acid-green: '#CCF381'
  electric-blue: '#648CF3'
  magenta-pop: '#D9689E'
  ink-black: '#0F0F11'
  pure-white: '#FFFFFF'
typography:
  headline-xl:
    fontFamily: Sora
    fontSize: 64px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Sora
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
  section-gap: 120px
---

## Brand & Style

This design system is built on a high-contrast, modern aesthetic that blends **Minimalism** with **High-Contrast/Bold** elements. It is designed for high-impact digital experiences, targeting a tech-forward, creative audience that values clarity and punchy visuals.

The visual narrative is driven by a deep "Ink" background contrasted against "Acid" highlights. The style avoids unnecessary decoration, focusing instead on sharp execution, generous whitespace, and vibrant pops of functional color to guide the user's eye. The emotional response is one of confidence, precision, and energy.

## Colors

The palette is anchored by **Ink Black** as the primary canvas, creating a sophisticated dark mode default. 

- **Primary (Acid Green):** Used for primary actions, success states, and critical highlights. It provides the highest contrast against the dark background.
- **Secondary (Electric Blue):** Used for secondary actions, links, and informative accents.
- **Tertiary (Magenta Pop):** Used sparingly for celebratory moments, badges, or specific feature highlights to prevent visual fatigue.
- **Neutral:** The background is a slightly desaturated black to reduce eye strain while maintaining deep contrast. Text defaults to Pure White or a high-opacity tint of white.

## Typography

The typography strategy uses a trio of fonts to distinguish between hierarchy levels:

1.  **Sora (Headlines):** A geometric sans with a futuristic feel. Use tight letter-spacing for large headlines to create a "compact" and impactful look.
2.  **Hanken Grotesk (Body):** A clean, highly legible font for long-form content and UI labels. It balances the expressiveness of the headlines.
3.  **JetBrains Mono (Labels/Technical):** Used for micro-copy, tags, and data points to emphasize the technical precision of the design system. 

All typography should be rendered with high contrast against the background. Use the `Pure White` color for maximum readability on the `Ink Black` surfaces.

## Layout & Spacing

The design system utilizes a **Fixed Grid** for desktop to maintain a controlled, editorial feel, transitioning to a fluid model for mobile.

- **Desktop (1440px+):** 12-column grid with 24px gutters and 64px side margins. 
- **Tablet (768px - 1439px):** 8-column grid with 20px gutters and 32px side margins.
- **Mobile (< 767px):** 4-column fluid grid with 16px gutters and 16px side margins.

A strict 8px baseline rhythm is applied to all components. Section gaps are intentionally large (120px+) to allow the high-contrast elements room to breathe without overwhelming the user.

## Elevation & Depth

This design system avoids traditional shadows in favor of **Tonal Layers** and **Low-Contrast Outlines**.

Depth is created by stacking surfaces of slightly different luminances. A "Surface-1" might be `#0F0F11`, while a "Surface-2" (cards or modals) is `#1A1A1E`. 

To further define elements, use 1px solid borders. For subtle separation, use a low-opacity white border (e.g., `rgba(255, 255, 255, 0.1)`). For interactive elements, use high-contrast borders using the brand colors (Acid Green or Electric Blue) to indicate focus or selection. No blurs or skeuomorphic effects are permitted.

## Shapes

The shape language is **Soft** but disciplined. We use a consistent 4px (0.25rem) radius for standard UI elements like input fields and buttons. Larger containers like cards should use a 12px (0.75rem) radius to feel more approachable. 

The goal is to maintain a "technical" edge; avoid fully rounded "pill" shapes unless used for small, discrete tags or chips.

## Components

- **Buttons:** Primary buttons use a solid `Acid Green` background with `Ink Black` text. Secondary buttons use a `Pure White` 1px outline with white text. Interactions should trigger a slight scale-down (98%) to provide tactile feedback.
- **Input Fields:** Dark backgrounds (slightly lighter than the page background) with a 1px `rgba(255,255,255,0.2)` border. On focus, the border transitions to `Electric Blue`.
- **Chips/Tags:** Use the `JetBrains Mono` font. Backgrounds should be low-opacity versions of the primary/secondary colors (e.g., 10% opacity) with a solid 1px border of the same color.
- **Cards:** No shadows. Use a subtle background lift (Surface-2) and a 1px border.
- **Lists:** Items separated by thin 1px lines. Use high-contrast hover states where the entire row background changes to a very dark gray (`#1F1F23`).
- **Checkboxes/Radios:** Square for checkboxes, circular for radios. When active, fill completely with `Acid Green`.