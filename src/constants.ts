import type { ColorInfo, FontInfo, PaperType } from './types';

export const COLORS: ColorInfo[] = [
  { hex: '#1a1a1a', label: 'Black' },
  { hex: '#1e40af', label: 'Blue' },
  { hex: '#c0392b', label: 'Red' },
  { hex: '#15803d', label: 'Green' },
  { hex: '#7e22ce', label: 'Purple' },
  { hex: '#c2410c', label: 'Orange' },
  { hex: '#be185d', label: 'Pink' },
  { hex: '#92400e', label: 'Brown' },
];

// ─── Mixed / Dynamic Font Definitions ────────────────────────────────────────
// These virtual fonts are rendered by mixing multiple real handwriting fonts.
// The family name is used as the key to look up the font pool at render time.

export const MIXED_FONT_POOLS: Record<string, string[]> = {
  '\u2728 Human Mix Pro\u2122': [
    'Patrick Hand', 'Handlee', 'Kalam', 'Caveat',
    'Architects Daughter', 'Indie Flower', 'Gloria Hallelujah',
    'Shadows Into Light', 'Homemade Apple', 'Reenie Beanie',
    'Nanum Pen Script', 'Nanum Brush Script', 'Gochi Hand',
    'Schoolbell', 'Short Stack',
  ],
  '\u2728 RealWriter\u2122': [
    'Caveat', 'Architects Daughter', 'Indie Flower',
    'Shadows Into Light', 'Handlee', 'Gloria Hallelujah',
    'Homemade Apple', 'Patrick Hand',
  ],
  '\u2728 Student Notes\u2122': [
    'Patrick Hand', 'Kalam', 'Handlee', 'Schoolbell',
    'Short Stack', 'Gochi Hand', 'Comic Neue', 'Nanum Pen Script',
  ],
  '\u2728 Quick Notes\u2122': [
    'Caveat', 'Caveat Brush', 'Nanum Brush Script',
    'Just Another Hand', 'Reenie Beanie', 'Kalam',
  ],
};

export const MIXED_FONT_FAMILIES = new Set(Object.keys(MIXED_FONT_POOLS));

export const FONTS: FontInfo[] = [
  // -- Mixed / Dynamic fonts (shown at top) --
  { family: '\u2728 Human Mix Pro\u2122',  label: '\u2728 Human Mix Pro\u2122' },
  { family: '\u2728 RealWriter\u2122',     label: '\u2728 RealWriter\u2122' },
  { family: '\u2728 Student Notes\u2122',  label: '\u2728 Student Notes\u2122' },
  { family: '\u2728 Quick Notes\u2122',    label: '\u2728 Quick Notes\u2122' },
  // -- Originals --
  { family: 'Caveat',              label: 'Caveat' },
  { family: 'Dancing Script',      label: 'Dancing Script' },
  { family: 'Homemade Apple',      label: 'Homemade Apple' },
  { family: 'Sacramento',          label: 'Sacramento' },
  { family: 'Shadows Into Light',  label: 'Shadows Into Light' },
  { family: 'Indie Flower',        label: 'Indie Flower' },
  { family: 'Kalam',               label: 'Kalam' },
  // -- New additions --
  { family: 'Patrick Hand',        label: 'Patrick Hand' },
  { family: 'Gochi Hand',          label: 'Gochi Hand' },
  { family: 'Schoolbell',          label: 'Schoolbell' },
  { family: 'Short Stack',         label: 'Short Stack' },
  { family: 'Reenie Beanie',       label: 'Reenie Beanie' },
  { family: 'Just Another Hand',   label: 'Just Another Hand' },
  { family: 'Neucha',              label: 'Neucha' },
  { family: 'Cedarville Cursive',  label: 'Cedarville Cursive' },
];

export const PAPER_TYPES: { type: PaperType; label: string; icon: string }[] = [
  { type: 'double', label: 'Double Rule', icon: '\ud83d\udcd3' },
  { type: 'lined',  label: 'Lined',       icon: '\ud83d\udcc4' },
  { type: 'plain',  label: 'Plain',       icon: '\u2b1c' },
  { type: 'grid',   label: 'Grid',        icon: '\u229e' },
  { type: 'cream',  label: 'Cream',       icon: '\ud83d\udcdc' },
];

export const PAPER_BG_COLORS: Record<PaperType, string> = {
  double: '#ffffff',
  lined:  '#ffffff',
  plain:  '#ffffff',
  grid:   '#ffffff',
  cream:  '#fdf8ec',
};
