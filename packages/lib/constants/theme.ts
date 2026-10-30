import type { TCssVarsSchema } from '../types/css-vars';

/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * KEEP THIS FILE IN SYNC WITH `packages/ui/styles/theme.css`.
 *
 * These are the light-mode default values for the CSS custom properties
 * defined under `:root` in the theme stylesheet, exposed here as hex strings
 * so they can be used as defaults for colour-picker UI components and other
 * places that don't render through CSS variables.
 *
 * If you change a value in `theme.css`, update it here too. There is NO
 * automated check linking the two files; they have drifted historically
 * and will drift again unless you update both.
 *
 * Computed via `colord({ h, s, l }).toHex()` — see the inline HSL comments
 * for the source-of-truth values from `theme.css`.
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 */
export const DEFAULT_BRAND_COLORS = {
  background: '#ffffff', //              0 0% 100%
  foreground: '#17171a', //              240 6.1% 9.6%
  muted: '#f6f3ee', //                   37.5 30.8% 94.9%
  mutedForeground: '#6b7080', //         225.7 8.9% 46.1%
  popover: '#ffffff', //                 0 0% 100%
  popoverForeground: '#17171a', //       240 6.1% 9.6%
  card: '#ffffff', //                    0 0% 100%
  cardBorder: '#e8e4e2', //              30 10% 90%
  cardForeground: '#17171a', //          240 6.1% 9.6%
  fieldCard: '#fde7e9', //               355 90% 95%
  fieldCardBorder: '#f4919a', //         355 85% 72%
  fieldCardForeground: '#17171a', //     240 6.1% 9.6%
  widget: '#f7f7f7', //                  0 0% 97%
  widgetForeground: '#f2f2f2', //        0 0% 95%
  border: '#e8e4e2', //                  30 10% 90%
  input: '#e8e4e2', //                   30 10% 90%
  primary: '#e30516', //                 355.4 95.7% 45.5%
  primaryForeground: '#ffffff', //       0 0% 100%
  secondary: '#f6f3ee', //               37.5 30.8% 94.9%
  secondaryForeground: '#17171a', //     240 6.1% 9.6%
  accent: '#f6f3ee', //                  37.5 30.8% 94.9%
  accentForeground: '#17171a', //        240 6.1% 9.6%
  destructive: '#dc2828', //             0 72% 51%
  destructiveForeground: '#ffffff', //   0 0% 100%
  ring: '#e30516', //                    355.4 95.7% 45.5%
  warning: '#e1cb05', //                 54 96% 45%
  envelopeEditorBackground: '#f8f5f1', //34.3 33.3% 95.9%
  // `cardBorderTint` is intentionally excluded from the colour-picker UI:
  // unlike the rest of these tokens it is consumed via `rgb(var(--token))`
  // (not `hsl(...)`) and stored as raw RGB triplets in `theme.css`. It does
  // not flow through `toNativeCssVars` and is not user-customisable from the
  // branding form. `radius` is a length, not a colour, so it lives in
  // `DEFAULT_BRAND_RADIUS` below.
} as const satisfies Record<keyof Omit<TCssVarsSchema, 'radius' | 'cardBorderTint'>, string>;

export const DEFAULT_BRAND_RADIUS = '0.5rem';
