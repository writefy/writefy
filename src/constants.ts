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

// ─── FONTS ────────────────────────────────────────────────────────────────────
// Regular fonts — shown individually in the picker
export const FONTS: FontInfo[] = [
  // ── Originals ──
  { family: 'Caveat',              label: 'Caveat' },
  { family: 'Dancing Script',      label: 'Dancing Script' },
  { family: 'Homemade Apple',      label: 'Homemade Apple' },
  { family: 'Sacramento',          label: 'Sacramento' },
  { family: 'Shadows Into Light',  label: 'Shadows Into Light' },
  { family: 'Indie Flower',        label: 'Indie Flower' },
  { family: 'Kalam',               label: 'Kalam' },

  // ── New additions ──
  { family: 'Patrick Hand',        label: 'Patrick Hand' },
  { family: 'Gochi Hand',          label: 'Gochi Hand' },
  { family: 'Schoolbell',          label: 'Schoolbell' },
  { family: 'Short Stack',         label: 'Short Stack' },
  { family: 'Reenie Beanie',       label: 'Reenie Beanie' },
  { family: 'Just Another Hand',   label: 'Just Another Hand' },
  { family: 'Neucha',              label: 'Neucha' },
  { family: 'Cedarville Cursive',  label: 'Cedarville Cursive' },

  // ── ✦ Mix fonts — these trigger the font mixing engine ──
  { family: 'Student Classic Mix', label: '✦ Student Classic Mix' },
  { family: 'Marker Pen Mix',      label: '✦ Marker Pen Mix' },
  { family: 'Neat Writer Mix',     label: '✦ Neat Writer Mix' },
  { family: 'Cursive Blend Mix',   label: '✦ Cursive Blend Mix' },
];

export const PAPER_TYPES: { type: PaperType; label: string; icon: string }[] = [
  { type: 'double', label: 'Double Rule', icon: '📓' },
  { type: 'lined',  label: 'Lined',       icon: '📄' },
  { type: 'plain',  label: 'Plain',       icon: '⬜' },
  { type: 'grid',   label: 'Grid',        icon: '⊞' },
  { type: 'cream',  label: 'Cream',       icon: '📜' },
];

export const PAPER_BG_COLORS: Record<PaperType, string> = {
  double: '#ffffff',
  lined:  '#ffffff',
  plain:  '#ffffff',
  grid:   '#ffffff',
  cream:  '#fdf8ec',
};
