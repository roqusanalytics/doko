# Doko UI

The existing reader layout and typography remain authoritative.

- Accent fill: Mint #C5E1CB; foreground: Ink #1A1A1A.
- Accent text/focus: #305D40 in light mode, Mint in dark mode.
- Shared control radius: `--radius: 12px`. Document annotation geometry and circular samples/status dots retain their shape.
- Hover: soft Mint tint. Selected: stronger tint, visible label/icon; buttons have no decorative border.
- Keyboard focus: 2px contrasting outline with soft feedback; do not change layout.
- Color targets: 32px rounded controls with 20px circular samples inside; compact annotation popovers preserve their 26px footprint and positioning.
- PDF.js toolbar controls must stay at UI font scale and share the control surface/focus tokens.
- Preserve light/dark and custom appearance backgrounds, disabled states, keyboard navigation, and reduced-motion behavior.

## Regular glass

- Use restrained Regular-style material on floating navigation and contextual controls. Keep document pages and editing surfaces opaque.
- Shared `--glass`, `--glass-chrome`, `--glass-filter`, and `--glass-shadow` tokens follow the existing light/dark/custom surface colors.
- Glass containers have no decorative border; child controls use soft fills, never nested backdrop filters.
- Reduce Transparency, Increase Contrast, forced colors, and missing backdrop-filter support use solid surfaces. Keep existing reduced-motion behavior.
- This is a cross-platform CSS adaptation, not the native Apple Liquid Glass material.

## On-page selection

- PDF object selection uses a temporary soft Mint fill, 12px corners and circular resize handles. Keep bounding boxes, hit areas and document output unchanged. Keyboard focus stays outlined.
- Highlight paths keep their geometry and annotation colors. Selection cues use Mint.
- Destructive Remove controls use semantic red hover fill, icon and keyboard focus in both themes; other actions retain Mint.

## Optional window transparency

- Settings → Appearance → Window transparency is off by default and persists across tabs and restarts. macOS uses sidebar vibrancy; supported Windows 11 uses acrylic. Unsupported systems keep an opaque window.
- Only sidebar and navigation reveal the material. Document canvases remain opaque. System accessibility preferences override translucency.
- The main tool group has no enclosing black/opaque layer. Hover raises labels by 1px with a 240ms eased lift and 320ms return while icons and hit targets remain fixed; Reduce Motion disables the lift.
- Shared outline icons use a consistent 1.6 stroke and rounded silhouettes and softened corners inspired by the supplied reference.

## Action label clarity

- Standard action labels use 14px/600, compact actions 13px/600. Mint keeps opaque Ink text.
- Primary-action hover adjusts only background color; never apply brightness/filter to the whole control and its text.

- Native material must be available to the macOS compositor at window creation; the saved toggle can then disable/enable it before showing the window.
- Enabled navigation tint is 22% opaque so the native frosted backdrop remains visible. The effective palette scheme also drives native material appearance, including dark custom backgrounds in Light mode. PNG alpha checks guard navigation transmission and an opaque document canvas.

- With window transparency, selected toolbar/icon/sidebar controls use an opaque neutral fill tinted by the current appearance background (16% background, 84% #C5CEC7) with Ink foreground in both appearances. Selection never relies on the native backdrop tint alone.
