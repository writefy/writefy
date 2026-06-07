export type LineColor = string;
export type FontFamily = string;
export type PaperType = 'double' | 'lined' | 'plain' | 'grid' | 'cream';

export interface ColourSpan { start: number; end: number; color: LineColor; }
export interface Chunk { text: string; color: LineColor; }
export interface ColorInfo { hex: LineColor; label: string; }
export interface FontInfo { family: FontFamily; label: string; }

export interface AdminSettings {
  password: string;
  publisherId: string;
  adSlot1: string; adSlot2: string; adSlot3: string;
  siteName: string; siteDescription: string; siteKeywords: string;
  siteAuthor: string; ogTitle: string; ogDescription: string;
  analyticsId: string;
  customFonts: FontInfo[];
  customColors: ColorInfo[];
  supabaseUrl: string; supabaseAnonKey: string;
  adNetworkScript: string; adNetworkMeta: string;
  supportEmail: string;
  adsEnabled: boolean;
  siteDomain: string;
}
