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

export const FONTS: FontInfo[] = [
  { family: 'Caveat', label: 'Caveat' },
  { family: 'Dancing Script', label: 'Dancing Script' },
  { family: 'Homemade Apple', label: 'Homemade Apple' },
  { family: 'Sacramento', label: 'Sacramento' },
  { family: 'Shadows Into Light', label: 'Shadows Into Light' },
  { family: 'Indie Flower', label: 'Indie Flower' },
  { family: 'Kalam', label: 'Kalam' },
];

export const PAPER_TYPES: { type: PaperType; label: string; icon: string }[] = [
  { type: 'double', label: 'Double Rule', icon: '📓' },
  { type: 'lined', label: 'Lined', icon: '📄' },
  { type: 'plain', label: 'Plain', icon: '⬜' },
  { type: 'grid', label: 'Grid', icon: '⊞' },
  { type: 'cream', label: 'Cream', icon: '📜' },
];

export const PAPER_BG_COLORS: Record<PaperType, string> = {
  double: '#ffffff',
  lined: '#ffffff',
  plain: '#ffffff',
  grid: '#ffffff',
  cream: '#fdf8ec',
};
