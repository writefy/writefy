import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { ColourSpan, LineColor, FontFamily, PaperType, Chunk } from './types';
import { COLORS, FONTS, PAPER_TYPES, PAPER_BG_COLORS } from './constants';
import { applySpan, clampSpans, buildChunks, chunksToLines } from './utils/spanUtils';
import AdBanner from './components/AdBanner';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
// A4 at 96dpi
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

// Minimum ruled-line grid. Actual spacing grows with font size so letters never overlap.
const MIN_LINE_HEIGHT_PX = 40;

// Paper interior padding
const PAPER_PAD_LEFT = 60;   // px left margin of text area (before user's margin)
const PAPER_PAD_RIGHT = 48;  // px right margin
const PAPER_PAD_TOP = 28;    // px before first ruled line
const PAPER_PAD_BOTTOM = 32; // px at bottom

// Double Rule paper constants — defined here so canvas renderer can use them
const DBL_HEADER_H = 80;
const DBL_MARGIN1  = 52;
const DBL_MARGIN2  = 59;  // only 7px gap — tight double rule like reference image

const getLineHeight = (fontSize: number) => Math.max(MIN_LINE_HEIGHT_PX, Math.ceil(fontSize * 1.35));
const getFirstBaseline = (lineHeight: number) => PAPER_PAD_TOP + lineHeight;
const getLinesPerPage = (lineHeight: number, topOffset = 0) => Math.floor(
  (A4_HEIGHT_PX - getFirstBaseline(lineHeight) - topOffset - PAPER_PAD_BOTTOM) / lineHeight
) + 1;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function hexWithAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── EXPORT ANIMATION OVERLAY ────────────────────────────────────────────────
function ExportAnimation({ type, pageCount = 1 }: { type: 'png' | 'pdf' | false; pageCount?: number }) {
  const [progress, setProgress] = useState(5);
  const [stepIdx, setStepIdx] = useState(0);

  const pngSteps = ['Capturing your handwriting', 'Compositing layers', 'Optimising image', 'Finalising PNG…'];
  const pdfSteps = [
    `Rendering ${pageCount} page${pageCount > 1 ? 's' : ''} into a single document`,
    'Compositing handwriting layers',
    'Embedding fonts & colours',
    'Compiling PDF…',
    'Almost done…',
  ];
  const steps = type === 'png' ? pngSteps : pdfSteps;
  const title = type === 'png' ? 'Generating PNG…' : 'Generating PDF…';
  const gradient = type === 'png'
    ? 'from-indigo-500 to-blue-500'
    : 'from-pink-500 to-purple-600';

  useEffect(() => {
    if (!type) { setProgress(5); setStepIdx(0); return; }
    setProgress(5); setStepIdx(0);
    const intervals: ReturnType<typeof setTimeout>[] = [];
    // progress ticks
    const targets = [10, 25, 45, 65, 80, 92];
    targets.forEach((p, i) => {
      intervals.push(setTimeout(() => setProgress(p), (i + 1) * 600));
    });
    // step text ticks
    steps.forEach((_, i) => {
      if (i > 0) intervals.push(setTimeout(() => setStepIdx(i), i * 900));
    });
    return () => intervals.forEach(clearTimeout);
  }, [type]);

  if (!type) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-6">
      <div className="bg-white rounded-[2rem] shadow-2xl p-8 flex flex-col items-center gap-5 w-full max-w-sm">
        {/* Icon */}
        <div className={`h-20 w-20 rounded-[1.4rem] bg-gradient-to-br ${gradient} flex items-center justify-center shadow-xl`}>
          <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10 text-white" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v13m0 0l-4-4m4 4l4-4" />
          </svg>
        </div>

        {/* Title */}
        <p className="text-2xl font-black text-slate-900 tracking-tight">{title}</p>

        {/* Subtitle */}
        <p className="text-slate-500 text-sm text-center min-h-[20px] transition-all duration-300">
          {steps[stepIdx]}
        </p>

        {/* Progress bar */}
        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-2.5 rounded-full bg-gradient-to-r ${gradient} transition-all duration-500 ease-out`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-slate-400 text-sm font-semibold">{progress}%</p>
      </div>
    </div>
  );
}

async function waitForFonts() {
  if ('fonts' in document) {
    await document.fonts.ready;
  }
}

function renderHandwritingCanvas(
  pageLines: Chunk[][],
  options: {
    font: FontFamily;
    fontSize: number;
    marginLeft: number;
    lineHeight: number;
    paperType: PaperType;
    defaultColor: LineColor;
    showEmpty?: boolean;
    scale?: number;
    wordSpacing?: number;
    pageDate?: string;
    pageNumber?: number;
    totalPages?: number;
    showHeader?: boolean;
    textAlign?: string;
  }
) {
  const scale = options.scale ?? 2;
  const canvas = document.createElement('canvas');
  canvas.width = A4_WIDTH_PX * scale;
  canvas.height = A4_HEIGHT_PX * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context is not available.');
  ctx.scale(scale, scale);

  const bg = options.paperType === 'cream' ? '#fdf8ec' : '#ffffff';
  // firstBaseline must match PaperBg ruled line positions exactly
  const firstBaseline = options.showHeader && options.paperType !== 'double'
    ? DBL_HEADER_H + options.lineHeight           // lined+header: lines start after header
    : PAPER_PAD_TOP + options.lineHeight;          // normal: PAPER_PAD_TOP + lineHeight
  const textX = PAPER_PAD_LEFT + options.marginLeft;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);

  if (options.paperType === 'cream') {
    ctx.fillStyle = 'rgba(254,249,235,0.55)';
    ctx.fillRect(0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);
  }

  // ── Universal page header (all paper types when showHeader=true) ──────────
  if (options.showHeader) {
    const isDoubleC = options.paperType === 'double';
    const hFont = options.font;
    ctx.save();
    // Background for non-double
    if (!isDoubleC) {
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.fillRect(0, 0, A4_WIDTH_PX, DBL_HEADER_H);
      ctx.strokeStyle = 'rgba(216,72,142,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, DBL_HEADER_H); ctx.lineTo(A4_WIDTH_PX, DBL_HEADER_H); ctx.stroke();
    }
    // Draw scroll badge right-side — matching reference image
    const bx = A4_WIDTH_PX - 238;
    const by = 10;
    const bw = 215; const bh = 56;
    const bmx = bx + bw / 2; const bmy = by + bh / 2;
    // Badge pill body
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'rgba(216,72,142,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 20, by);
    ctx.quadraticCurveTo(bmx, by - 4, bx + bw - 20, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, bmy);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - 20, by + bh);
    ctx.quadraticCurveTo(bmx, by + bh + 4, bx + 20, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, bmy);
    ctx.quadraticCurveTo(bx, by, bx + 20, by);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Left scroll circle (double ring)
    ctx.beginPath(); ctx.ellipse(bx + 12, bmy, 12, 20, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'white'; ctx.strokeStyle = 'rgba(216,72,142,0.75)'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(bx + 12, bmy, 6, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,240,250,0.7)'; ctx.strokeStyle = 'rgba(216,72,142,0.5)'; ctx.lineWidth = 1;
    ctx.fill(); ctx.stroke();
    // Right scroll circle
    ctx.beginPath(); ctx.ellipse(bx + bw - 12, bmy, 12, 20, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'white'; ctx.strokeStyle = 'rgba(216,72,142,0.75)'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(bx + bw - 12, bmy, 6, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,240,250,0.7)'; ctx.strokeStyle = 'rgba(216,72,142,0.5)'; ctx.lineWidth = 1;
    ctx.fill(); ctx.stroke();
    // Underlines inside badge
    ctx.strokeStyle = 'rgba(216,72,142,0.55)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(bx + 58, by + 27); ctx.lineTo(bx + bw - 28, by + 27); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + 58, by + 44); ctx.lineTo(bx + bw - 28, by + 44); ctx.stroke();
    // Date label + value in handwriting font — use selected ink color
    ctx.fillStyle = options.defaultColor;
    ctx.font = `13px "${hFont}", cursive`;
    ctx.fillText('Date', bx + 30, by + 23);
    ctx.font = `12px "${hFont}", cursive`;
    if (options.pageDate) ctx.fillText(options.pageDate, bx + 70, by + 23);
    // Page label + value in handwriting font
    ctx.font = `13px "${hFont}", cursive`;
    ctx.fillText('Page', bx + 30, by + 41);
    ctx.font = `12px "${hFont}", cursive`;
    ctx.fillText(String(options.pageNumber ?? 1), bx + 70, by + 41);
    ctx.restore();
  }

  // ── Double Rule paper rendering ──────────────────────────────────────────
  if (options.paperType === 'double') {
    // Use module-level DBL_* constants
    ctx.strokeStyle = 'rgba(216,72,142,0.65)';
    ctx.lineWidth = 1.5;
    // Header bottom line
    ctx.beginPath(); ctx.moveTo(0, DBL_HEADER_H); ctx.lineTo(A4_WIDTH_PX, DBL_HEADER_H); ctx.stroke();
    // Margin lines
    ctx.beginPath(); ctx.moveTo(DBL_MARGIN1, 0); ctx.lineTo(DBL_MARGIN1, A4_HEIGHT_PX); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(DBL_MARGIN2, 0); ctx.lineTo(DBL_MARGIN2, A4_HEIGHT_PX); ctx.stroke();
    // Ruled body lines
    ctx.strokeStyle = 'rgba(180,180,200,0.6)';
    ctx.lineWidth = 1;
    for (let y = DBL_HEADER_H + Math.round(options.lineHeight * 0.85); y <= A4_HEIGHT_PX - 20; y += options.lineHeight) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(A4_WIDTH_PX, y); ctx.stroke();
    }
  }  // end double-rule paper drawing (header text drawn by universal header block above)

  if (options.paperType === 'lined' || options.paperType === 'grid') {
    ctx.save();
    ctx.strokeStyle = options.paperType === 'lined' ? 'rgba(147,197,253,0.75)' : 'rgba(147,197,253,0.45)';
    ctx.lineWidth = 1;
    const lineStartY = firstBaseline; // already accounts for showHeader via firstBaseline formula
    for (let y = lineStartY; y <= A4_HEIGHT_PX; y += options.lineHeight) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(A4_WIDTH_PX, y + 0.5);
      ctx.stroke();
    }
    if (options.paperType === 'grid') {
      for (let x = 0; x <= A4_WIDTH_PX; x += options.lineHeight) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, A4_HEIGHT_PX);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (options.paperType === 'lined') {
    ctx.save();
    ctx.strokeStyle = 'rgba(239,68,68,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(textX + 0.5, 0);
    ctx.lineTo(textX + 0.5, A4_HEIGHT_PX);
    ctx.stroke();
    ctx.restore();
  }

  // For double rule, text starts after second margin line
  if (options.paperType === 'double') {
    const dblX = DBL_MARGIN2 + 4 + (options.marginLeft ?? 0);  // 4px = tight against margin line, no visible gap
    const dblFirstY = DBL_HEADER_H + Math.round(options.lineHeight * 0.85);  // text baseline ON first ruled line
    ctx.save();
    ctx.beginPath();
    ctx.rect(dblX, DBL_HEADER_H - 4, A4_WIDTH_PX - dblX - PAPER_PAD_RIGHT, A4_HEIGHT_PX - DBL_HEADER_H + 4 - PAPER_PAD_BOTTOM);
    ctx.clip();
    ctx.font = `${options.fontSize}px "${options.font}", cursive`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    pageLines.forEach((lineChunks, lineIndex) => {
      let x = dblX;
      const y = dblFirstY + lineIndex * options.lineHeight;
      lineChunks.forEach(chunk => {
        ctx.fillStyle = chunk.color;
        ctx.fillText(chunk.text, x, y);
        x += ctx.measureText(chunk.text).width + (options.wordSpacing ?? 0);
      });
    });
    ctx.restore();
    return canvas;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAPER_PAD_LEFT, 0, A4_WIDTH_PX - PAPER_PAD_LEFT - PAPER_PAD_RIGHT, A4_HEIGHT_PX - PAPER_PAD_BOTTOM);
  ctx.clip();
  ctx.font = `${options.fontSize}px "${options.font}", cursive`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = (options.textAlign as CanvasTextAlign) || 'left';

  if (options.showEmpty && pageLines.length === 0) {
    ctx.fillStyle = hexWithAlpha(options.defaultColor, 0.3);
    ctx.fillText('Start typing to see your handwriting here...', textX, firstBaseline);
  } else {
    pageLines.forEach((lineChunks, lineIndex) => {
      const lineText = lineChunks.map(c => c.text).join('');
      let x = options.textAlign === 'center' ? A4_WIDTH_PX / 2 - ctx.measureText(lineText).width / 2 : options.textAlign === 'right' ? A4_WIDTH_PX - PAPER_PAD_RIGHT - ctx.measureText(lineText).width : textX;
      const y = firstBaseline + lineIndex * options.lineHeight;
      lineChunks.forEach(chunk => {
        ctx.fillStyle = chunk.color;
        ctx.fillText(chunk.text, x, y);
        x += ctx.measureText(chunk.text).width + (options.wordSpacing ?? 0);
      });
    });
  }
  ctx.restore();

  return canvas;
}

function measureTextWidth(text: string, font: FontFamily, fontSize: number) {
  const canvas = measureTextWidth.canvas ?? (measureTextWidth.canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * fontSize * 0.55;
  ctx.font = `${fontSize}px "${font}", cursive`;
  return ctx.measureText(text).width;
}
measureTextWidth.canvas = undefined as HTMLCanvasElement | undefined;

function pushChunk(line: Chunk[], text: string, color: LineColor) {
  if (!text) return;
  const last = line[line.length - 1];
  if (last && last.color === color) {
    last.text += text;
  } else {
    line.push({ text, color });
  }
}

function wrapChunksToPageLines(
  chunks: Chunk[],
  font: FontFamily,
  fontSize: number,
  maxWidth: number,
  defaultColor: LineColor
) {
  // Preserve ALL lines including blank ones — empty lines = empty ruled lines in preview/export
  const explicitLines = chunksToLines(chunks);

  const sourceLines = explicitLines.length ? explicitLines : chunks.length ? chunksToLines(chunks) : [];
  const wrapped: Chunk[][] = [];

  sourceLines.forEach(sourceLine => {
    let line: Chunk[] = [];
    let width = 0;

    const isBlankSourceLine = sourceLine.length === 0 || sourceLine.every(c => c.text.trim().length === 0);

    const flush = (forceBlank = false) => {
      // Always push blank lines so empty lines appear in preview/export
      if (forceBlank || line.some(chunk => chunk.text.trim().length > 0)) {
        wrapped.push(line.length > 0 ? line : [{ text: '', color: defaultColor }]);
      }
      line = [];
      width = 0;
    };

    sourceLine.forEach(chunk => {
      const tokens = chunk.text.match(/\S+\s*|\s+/g) ?? [chunk.text];
      tokens.forEach(token => {
        const cleanToken = width === 0 ? token.replace(/^\s+/, '') : token;
        if (!cleanToken) return;

        const tokenWidth = measureTextWidth(cleanToken, font, fontSize);
        if (width > 0 && width + tokenWidth > maxWidth) {
          flush();
        }

        if (tokenWidth <= maxWidth) {
          pushChunk(line, cleanToken, chunk.color);
          width += tokenWidth;
          return;
        }

        // Break very long words/URLs character-by-character so no text is clipped.
        for (const char of cleanToken) {
          const charWidth = measureTextWidth(char, font, fontSize);
          if (width > 0 && width + charWidth > maxWidth) flush();
          pushChunk(line, char, chunk.color);
          width += charWidth;
        }
      });
    });

    // Force-push blank lines (empty paragraphs) so they appear as empty ruled lines
    flush(isBlankSourceLine);
  });

  if (wrapped.length === 0 && chunks.length > 0) {
    wrapped.push([{ text: '', color: defaultColor }]);
  }

  return wrapped;
}

// ─── PAPER BACKGROUND SVG LINES ──────────────────────────────────────────────
// Renders ruled lines as SVG so they're pixel-perfect and scale perfectly for export
interface PaperBgProps {
  type: PaperType;
  marginLeftPx: number;
  lineHeight: number;
  showHeader?: boolean;
}

const PaperBg: React.FC<PaperBgProps> = ({ type, marginLeftPx, lineHeight, showHeader = false }) => {
  if (type === 'plain') return null;

  const firstBaseline = getFirstBaseline(lineHeight);

  // ── DOUBLE RULE ────────────────────────────────────────────────────────────
  if (type === 'double') {
    const lines: React.ReactNode[] = [];
    // Ruled lines aligned to text baseline (DBL_HEADER_H + lineHeight * 0.85 + i*lineHeight)
    const dblTextFirstY = DBL_HEADER_H + Math.round(lineHeight * 0.85);
    for (let i = 0; i < 45; i++) {
      const y = dblTextFirstY + lineHeight * i;
      if (y > A4_HEIGHT_PX - 20) break;
      lines.push(
        <line key={`r${i}`} x1="0" y1={y} x2={A4_WIDTH_PX} y2={y}
          stroke="rgba(180,180,200,0.6)" strokeWidth="1" />
      );
    }
    return (
      <svg style={{ position: 'absolute', inset: 0, width: A4_WIDTH_PX, height: A4_HEIGHT_PX, pointerEvents: 'none' }}
        viewBox={`0 0 ${A4_WIDTH_PX} ${A4_HEIGHT_PX}`} preserveAspectRatio="none">
        {/* Header background */}
        <rect x="0" y="0" width={A4_WIDTH_PX} height={DBL_HEADER_H} fill="rgba(255,255,255,1)" />
        {/* Header bottom border (pink/magenta) */}
        <line x1="0" y1={DBL_HEADER_H} x2={A4_WIDTH_PX} y2={DBL_HEADER_H}
          stroke="rgba(216,72,142,0.7)" strokeWidth="1.5" />
        {/* Double margin lines (pink) */}
        <line x1={DBL_MARGIN1} y1="0" x2={DBL_MARGIN1} y2={A4_HEIGHT_PX}
          stroke="rgba(216,72,142,0.65)" strokeWidth="1.5" />
        <line x1={DBL_MARGIN2} y1="0" x2={DBL_MARGIN2} y2={A4_HEIGHT_PX}
          stroke="rgba(216,72,142,0.65)" strokeWidth="1.5" />
        {/* Ruled body lines */}
        {lines}
      </svg>
    );
  }

  // ── LINED ─────────────────────────────────────────────────────────────────
  if (type === 'lined') {
    const lines: React.ReactNode[] = [];
    const linedFirstY = showHeader ? DBL_HEADER_H + lineHeight : firstBaseline;
    for (let i = 0; i < 32; i++) {
      const y = linedFirstY + lineHeight * i; // exactly matches text baseline
      if (y > A4_HEIGHT_PX) break;
      lines.push(<line key={`h${i}`} x1="0" y1={y} x2={A4_WIDTH_PX} y2={y} stroke="rgba(147,197,253,0.75)" strokeWidth="1" />);
    }
    return (
      <svg style={{ position: 'absolute', inset: 0, width: A4_WIDTH_PX, height: A4_HEIGHT_PX, pointerEvents: 'none' }}
        viewBox={`0 0 ${A4_WIDTH_PX} ${A4_HEIGHT_PX}`} preserveAspectRatio="none">
        {lines}
        <line x1={marginLeftPx} y1="0" x2={marginLeftPx} y2={A4_HEIGHT_PX} stroke="rgba(239,68,68,0.4)" strokeWidth="1.5" />
      </svg>
    );
  }

  // ── GRID ──────────────────────────────────────────────────────────────────
  if (type === 'grid') {
    const hLines: React.ReactNode[] = [];
    const vLines: React.ReactNode[] = [];
    for (let i = 0; firstBaseline + i * lineHeight <= A4_HEIGHT_PX; i++) {
      const y = firstBaseline + i * lineHeight;
      hLines.push(<line key={`h${i}`} x1="0" y1={y} x2={A4_WIDTH_PX} y2={y} stroke="rgba(147,197,253,0.45)" strokeWidth="1" />);
    }
    for (let i = 0; i * lineHeight <= A4_WIDTH_PX; i++) {
      const x = i * lineHeight;
      vLines.push(<line key={`v${i}`} x1={x} y1="0" x2={x} y2={A4_HEIGHT_PX} stroke="rgba(147,197,253,0.45)" strokeWidth="1" />);
    }
    return (
      <svg style={{ position: 'absolute', inset: 0, width: A4_WIDTH_PX, height: A4_HEIGHT_PX, pointerEvents: 'none' }}
        viewBox={`0 0 ${A4_WIDTH_PX} ${A4_HEIGHT_PX}`} preserveAspectRatio="none">
        {hLines}{vLines}
      </svg>
    );
  }

  if (type === 'cream') {
    return <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(254,249,235,0.55)', pointerEvents: 'none' }} />;
  }

  return null;
};

// ─── HANDWRITING SVG TEXT ────────────────────────────────────────────────────
// SVG <text> with dominantBaseline="alphabetic" lets us set the real text
// baseline to the exact same y-coordinate as each ruled line. This is more
// reliable than CSS flex alignment and stays correct for every font size.
interface HandwritingSvgProps {
  pageLines: Chunk[][];
  font: FontFamily;
  fontSize: number;
  marginLeft: number;
  lineHeight: number;
  wordSpacing?: number;
  showEmpty?: boolean;
  defaultColor: LineColor;
  topOffset?: number;
  textAlign?: 'left'|'center'|'right';
  firstBaselineOverride?: number;
}

const HandwritingSvg: React.FC<HandwritingSvgProps> = ({
  pageLines, font, fontSize, marginLeft, lineHeight, wordSpacing = 0, showEmpty, defaultColor, topOffset = 0, textAlign = 'left', firstBaselineOverride,
}) => {
  // firstBaseline = y where alphabetic baseline sits (bottom of A,B,C; descenders g,p,y go below)
  // This MUST exactly match the y of ruled lines drawn in PaperBg
  const firstBaseline = firstBaselineOverride ?? (getFirstBaseline(lineHeight) + topOffset);
  const x = PAPER_PAD_LEFT + marginLeft;
  const maxTextWidth = A4_WIDTH_PX - x - PAPER_PAD_RIGHT;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: A4_WIDTH_PX, height: A4_HEIGHT_PX, overflow: 'hidden', pointerEvents: 'none' }}
      viewBox={`0 0 ${A4_WIDTH_PX} ${A4_HEIGHT_PX}`}
      preserveAspectRatio="none"
    >
      <defs>
        <clipPath id="pageTextClip">
          <rect x={PAPER_PAD_LEFT} y="0" width={A4_WIDTH_PX - PAPER_PAD_LEFT - PAPER_PAD_RIGHT} height={A4_HEIGHT_PX - PAPER_PAD_BOTTOM} />
        </clipPath>
      </defs>
      <g clipPath="url(#pageTextClip)">
        {showEmpty && pageLines.length === 0 ? (
          <text
            x={x}
            y={firstBaseline}
            fill={hexWithAlpha(defaultColor, 0.3)}
            fontFamily={`'${font}', cursive`}
            fontSize={fontSize}
            dominantBaseline="alphabetic"
            xmlSpace="preserve"
          >
            Start typing to see your handwriting here...
          </text>
        ) : (
          pageLines.map((lineChunks, idx) => {
            const y = firstBaseline + idx * lineHeight;
            return (
              <text
                key={idx}
                x={textAlign === 'center' ? A4_WIDTH_PX / 2 : textAlign === 'right' ? A4_WIDTH_PX - PAPER_PAD_RIGHT : x}
                y={y}
                fontFamily={`'${font}', cursive`}
                fontSize={fontSize}
                dominantBaseline="alphabetic"
                textAnchor={textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start'}
                xmlSpace="preserve"
                style={{ wordSpacing: wordSpacing > 0 ? `${wordSpacing}px` : undefined }}
              >
                {lineChunks.length === 0 ? (
                  <tspan fill="transparent"> </tspan>
                ) : (
                  lineChunks.map((chunk, i) => (
                    <tspan key={i} fill={chunk.color}>{chunk.text}</tspan>
                  ))
                )}
              </text>
            );
          })
        )}
      </g>
    </svg>
  );
};

// ─── SINGLE A4 PAGE ───────────────────────────────────────────────────────────
interface PageProps {
  pageLines: Chunk[][];
  font: FontFamily;
  fontSize: number;
  marginLeft: number;
  lineHeight: number;
  paperType: PaperType;
  pageNumber: number;
  totalPages: number;
  showEmpty?: boolean;
  defaultColor: LineColor;
  wordSpacing?: number;
  pageDate?: string;
  onDateChange?: (v: string) => void;
  showHeader?: boolean;
  textAlign?: 'left'|'center'|'right';
}

const A4Page: React.FC<PageProps> = ({
  pageLines, font, fontSize, marginLeft, lineHeight, paperType,
  pageNumber, totalPages, showEmpty, defaultColor, wordSpacing = 0,
  pageDate = '', onDateChange, showHeader = false, textAlign = 'left',
}) => {
  const bg = paperType === 'cream' ? '#fdf8ec' : '#ffffff';
  const textAreaLeft = PAPER_PAD_LEFT + marginLeft;
  const isDouble = paperType === 'double';

  return (
    <div
      className="a4-capture-page"
      style={{
        width: A4_WIDTH_PX,
        height: A4_HEIGHT_PX,
        backgroundColor: bg,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        flexShrink: 0,
        borderRadius: 12,
        border: '1px solid rgba(226,232,240,0.9)',
        boxShadow: '0 35px 80px rgba(15,23,42,0.22), 0 8px 24px rgba(15,23,42,0.08)',
      }}
    >
      <PaperBg type={paperType} marginLeftPx={textAreaLeft} lineHeight={lineHeight} showHeader={showHeader} />

      {/* ── Page Header: exact reference design with handwriting font ── */}
      {showHeader && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: DBL_HEADER_H,
          background: isDouble ? 'transparent' : 'rgba(255,255,255,0.97)',
          borderBottom: isDouble ? undefined : '1.5px solid rgba(216,72,142,0.5)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'flex-end', paddingRight: 20,
          zIndex: 2,
        }}>
          {/* Scroll ribbon badge — matching reference image exactly */}
          <div style={{ position: 'relative', width: 220, height: 64, flexShrink: 0 }}>
            {/* SVG scroll decoration */}
            <svg width="220" height="64" viewBox="0 0 220 64" fill="none"
              style={{ position: 'absolute', inset: 0 }}>
              {/* Left scroll circle */}
              <ellipse cx="20" cy="32" rx="18" ry="26"
                stroke="rgba(216,72,142,0.75)" strokeWidth="1.5" fill="white"/>
              <ellipse cx="20" cy="32" rx="10" ry="16"
                stroke="rgba(216,72,142,0.5)" strokeWidth="1" fill="rgba(255,240,250,0.6)"/>
              {/* Right scroll circle */}
              <ellipse cx="200" cy="32" rx="18" ry="26"
                stroke="rgba(216,72,142,0.75)" strokeWidth="1.5" fill="white"/>
              <ellipse cx="200" cy="32" rx="10" ry="16"
                stroke="rgba(216,72,142,0.5)" strokeWidth="1" fill="rgba(255,240,250,0.6)"/>
              {/* Main scroll body — pill/banner shape */}
              <path d="M20 8 Q110 4 200 8 Q208 8 208 32 Q208 56 200 56 Q110 60 20 56 Q12 56 12 32 Q12 8 20 8Z"
                stroke="rgba(216,72,142,0.75)" strokeWidth="1.5" fill="white"/>
              {/* Date underline */}
              <line x1="68" y1="30" x2="168" y2="30"
                stroke="rgba(216,72,142,0.55)" strokeWidth="1.2"/>
              {/* Page underline */}
              <line x1="68" y1="47" x2="168" y2="47"
                stroke="rgba(216,72,142,0.55)" strokeWidth="1.2"/>
            </svg>

            {/* Date row — HANDWRITING FONT */}
            <div style={{
              position: 'absolute', top: 10, left: 46, right: 30,
              display: 'flex', alignItems: 'baseline', gap: 4,
            }}>
              <span style={{
                fontFamily: `'${font}', cursive`,
                fontSize: 13, color: defaultColor,
                lineHeight: 1, whiteSpace: 'nowrap',
              }}>Date</span>
              <input
                type="text"
                value={pageDate}
                onChange={e => onDateChange?.(e.target.value)}
                placeholder="__________"
                readOnly={!onDateChange}
                style={{
                  fontFamily: `'${font}', cursive`,
                  fontSize: 12, color: defaultColor,
                  background: 'transparent', border: 'none', outline: 'none',
                  width: 90, paddingBottom: 0,
                  cursor: onDateChange ? 'text' : 'default',
                }}
              />
            </div>

            {/* Page row — HANDWRITING FONT */}
            <div style={{
              position: 'absolute', top: 32, left: 46, right: 30,
              display: 'flex', alignItems: 'baseline', gap: 4,
            }}>
              <span style={{
                fontFamily: `'${font}', cursive`,
                fontSize: 13, color: defaultColor,
                lineHeight: 1, whiteSpace: 'nowrap',
              }}>Page</span>
              <span style={{
                fontFamily: `'${font}', cursive`,
                fontSize: 12, color: defaultColor,
              }}>{pageNumber}</span>
            </div>
          </div>
        </div>
      )}

      <HandwritingSvg
        pageLines={pageLines}
        font={font}
        fontSize={fontSize}
        marginLeft={isDouble ? DBL_MARGIN2 - PAPER_PAD_LEFT + 4 : marginLeft}
        lineHeight={lineHeight}
        wordSpacing={wordSpacing}
        showEmpty={showEmpty}
        defaultColor={defaultColor}
        textAlign={textAlign}
        firstBaselineOverride={
          isDouble
            ? DBL_HEADER_H + Math.round(lineHeight * 0.85)           // matches dblTextFirstY in PaperBg
            : showHeader
              ? DBL_HEADER_H + lineHeight                             // lined+header: first line after header
              : PAPER_PAD_TOP + lineHeight                            // lined normal: matches PaperBg firstBaseline
        }
      />

      {/* Bottom page number — only shown when header is OFF */}
      {!showHeader && (
        <div style={{
          position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center',
          fontSize: 11, color: 'rgba(100,116,139,0.5)', fontFamily: 'sans-serif',
          pointerEvents: 'none',
        }}>
          {pageNumber} / {totalPages}
        </div>
      )}
    </div>
  );
};

// ─── CONVERTER PAGE ───────────────────────────────────────────────────────────
function ConverterPage() {
  const DEMO_TEXT = `What is the Solar System and how does it work?
The Solar System is a vast collection of celestial bodies bound together by the gravitational pull of the Sun. It consists of the Sun at the center, eight planets, dozens of moons, millions of asteroids, comets, and other space objects. The Sun contains about 99.8 percent of all the mass in the Solar System and its gravity keeps everything in orbit. The Solar System formed approximately 4.6 billion years ago from a giant cloud of gas and dust called a solar nebula. As the cloud collapsed under gravity, the Sun formed at the center while the remaining material clumped together to form the planets. The eight planets are divided into two groups. The inner rocky planets are Mercury, Venus, Earth and Mars. The outer gas giants are Jupiter, Saturn, Uranus and Neptune. Earth is the only planet known to support life due to its perfect distance from the Sun, liquid water, and protective atmosphere. The planets travel in elliptical orbits around the Sun and each planet takes a different amount of time to complete one orbit. Mercury takes only 88 days while Neptune takes 165 Earth years.
Key Points:
Solar System formed 4.6 billion years ago.
Sun holds 99.8 percent of total mass.
8 planets orbit the Sun.
Inner planets: Mercury, Venus, Earth, Mars.
Outer planets: Jupiter, Saturn, Uranus, Neptune.
Earth is the only planet with known life.
Mercury takes 88 days to orbit the Sun.
Neptune takes 165 years to orbit the Sun.
Saturn has rings made of ice and rock.
Gravity of Sun keeps all planets in orbit.`;
  const DEMO_SPANS: ColourSpan[] = [{ start: 0, end: 46, color: '#ef4444' }, { start: 47, end: 1140, color: '#2563eb' }, { start: 1141, end: 1152, color: '#000000' }, { start: 1153, end: 1195, color: '#16a34a' }, { start: 1196, end: 1233, color: '#16a34a' }, { start: 1234, end: 1258, color: '#16a34a' }, { start: 1259, end: 1302, color: '#16a34a' }, { start: 1303, end: 1351, color: '#16a34a' }, { start: 1352, end: 1393, color: '#16a34a' }, { start: 1394, end: 1433, color: '#16a34a' }, { start: 1434, end: 1475, color: '#16a34a' }, { start: 1476, end: 1514, color: '#16a34a' }, { start: 1515, end: 1557, color: '#16a34a' }];
  const [rawText, setRawText] = useState(DEMO_TEXT);
  const [spans, setSpans] = useState<ColourSpan[]>(DEMO_SPANS);
  const [defaultColor, setDefaultColor] = useState<LineColor>('#1e40af');
  const [font, setFont] = useState<FontFamily>('Caveat');
  const [fontSize, setFontSize] = useState(22);
  const [paperType, setPaperType] = useState<PaperType>('double');
  const [marginLeft, setMarginLeft] = useState(0);
  const [wordSpacing, setWordSpacing] = useState(0);
  const [pageDate, setPageDate] = useState('');
  const [showHeader, setShowHeader] = useState(true);
  const [textAlign, setTextAlign] = useState<'left'|'center'|'right'>('left');
  const [downloading, setDownloading] = useState<false | 'png' | 'pdf'>(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [fontReadyTick, setFontReadyTick] = useState(0);

  // Load admin settings live from Supabase (so every visitor gets latest)
  const [adminSettings, setAdminSettings] = useState<import('./types').AdminSettings>(DEFAULT_ADMIN);
  useEffect(() => {
    fetchPublicSettings().then(s => {
      if (s) {
        setAdminSettings(s);
        // Inject Google AdSense script when adsEnabled
        if (s.adsEnabled && !document.getElementById('adsense-script')) {
          const script = document.createElement('script');
          script.id = 'adsense-script';
          script.async = true;
          script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7120952836131032';
          script.crossOrigin = 'anonymous';
          document.head.appendChild(script);
        }
        // Inject @font-face for any custom uploaded fonts (TTF/OTF/WOFF/WOFF2)
        if (s.customFonts && s.customFonts.length > 0) {
          s.customFonts.forEach(f => {
            if (f.src) {
              // Only inject if not already injected
              const styleId = `custom-font-${f.family.replace(/\s+/g, '-')}`;
              if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                // Use stored format, but also provide a truetype fallback for Calligraphr
                // fonts that were saved with format='opentype' despite being TTF internally.
                const fmt = f.format || 'truetype';
                const fallbackSrc = fmt === 'opentype'
                  ? `url('${f.src}') format('opentype'), url('${f.src}') format('truetype')`
                  : `url('${f.src}') format('${fmt}')`;
                style.textContent = `@font-face { font-family: '${f.family}'; src: ${fallbackSrc}; font-display: swap; }`;
                document.head.appendChild(style);
              }
            } else {
              // Google Font — inject link tag
              const linkId = `google-font-${f.family.replace(/\s+/g, '-')}`;
              if (!document.getElementById(linkId)) {
                const link = document.createElement('link');
                link.id = linkId;
                link.rel = 'stylesheet';
                link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family)}&display=swap`;
                document.head.appendChild(link);
              }
            }
          });
        }
        // Inject custom adNetworkScript from admin panel if set
        if (s.adNetworkScript && !document.getElementById('ad-network-script')) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = s.adNetworkScript;
          const scriptEl = wrapper.querySelector('script');
          if (scriptEl) {
            const newScript = document.createElement('script');
            newScript.id = 'ad-network-script';
            if (scriptEl.src) newScript.src = scriptEl.src;
            if (scriptEl.async) newScript.async = true;
            if ((scriptEl as any).crossOrigin) newScript.crossOrigin = (scriptEl as any).crossOrigin;
            newScript.innerHTML = scriptEl.innerHTML;
            document.head.appendChild(newScript);
          }
        }
        // Inject adNetworkMeta tag if set
        if (s.adNetworkMeta && !document.getElementById('ad-network-meta')) {
          const wrapper2 = document.createElement('div');
          wrapper2.innerHTML = s.adNetworkMeta;
          const metaEl = wrapper2.querySelector('meta');
          if (metaEl) {
            metaEl.id = 'ad-network-meta';
            document.head.appendChild(metaEl);
          }
        }
      }
    });
  }, []);
  const allColors = useMemo(() => [
    ...COLORS,
    ...(adminSettings.customColors || []),
  ], [adminSettings]);
  const allFonts = useMemo(() => [
    ...FONTS,
    ...(adminSettings.customFonts || []),
  ], [adminSettings]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  const clampedSpans = useMemo(() => clampSpans(spans, rawText.length), [spans, rawText.length]);
  const allChunks = useMemo(() => buildChunks(rawText, clampedSpans, defaultColor), [rawText, clampedSpans, defaultColor]);
  const lineHeight = useMemo(() => getLineHeight(fontSize), [fontSize]);
  // Effective first baseline — must match HandwritingSvg firstBaselineOverride
  const effectiveFirstBaseline = paperType === 'double'
    ? DBL_HEADER_H + Math.round(lineHeight * 0.85)
    : showHeader ? DBL_HEADER_H + lineHeight
    : PAPER_PAD_TOP + lineHeight;
  const linesPerPage = useMemo(() => Math.floor(
    (A4_HEIGHT_PX - effectiveFirstBaseline - PAPER_PAD_BOTTOM) / lineHeight
  ) + 1, [effectiveFirstBaseline, lineHeight]);
  const maxTextWidth = A4_WIDTH_PX - PAPER_PAD_LEFT - PAPER_PAD_RIGHT - marginLeft;
  const allLines = useMemo(
    () => wrapChunksToPageLines(allChunks, font, fontSize, maxTextWidth, defaultColor),
    [allChunks, defaultColor, font, fontReadyTick, fontSize, maxTextWidth]
  );

  useEffect(() => {
    waitForFonts().then(() => setFontReadyTick(tick => tick + 1));
  }, [font]);

  const pages = useMemo<Chunk[][][]>(() => {
    if (allLines.length === 0) return [[]];
    const result: Chunk[][][] = [];
    for (let i = 0; i < allLines.length; i += linesPerPage) {
      result.push(allLines.slice(i, i + linesPerPage));
    }
    return result;
  }, [allLines, linesPerPage]);

  const usedColors = useMemo(() => {
    const set = new Set<LineColor>([defaultColor]);
    clampedSpans.forEach(s => set.add(s.color));
    return Array.from(set);
  }, [clampedSpans, defaultColor]);

  const selectedText = selection && selection.start < selection.end
    ? rawText.slice(selection.start, selection.end)
    : null;

  // ── Event handlers ─────────────────────────────────────────────────────────
  const captureSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    setSelection(s !== e ? { start: s, end: e } : null);
  }, []);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const t = e.target.value;
    setRawText(t);
    setSpans(prev => clampSpans(prev, t.length));
    setSelection(null);
  }, []);

  const applyColor = useCallback((color: LineColor) => {
    if (!selection) return;
    setSpans(prev => applySpan(prev, { start: selection.start, end: selection.end, color }));
  }, [selection]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportPNG = useCallback(async () => {
    const container = previewContainerRef.current;
    if (!container) return;
    setDownloading('png');
    await new Promise(r => setTimeout(r, 100)); // flush render so animation shows
    const startTime = Date.now();
    try {
      await waitForFonts();
      let canvas: HTMLCanvasElement;
      try {
        canvas = renderHandwritingCanvas(pages[0] ?? [], {
          font,
          fontSize,
          marginLeft,
          lineHeight,
          paperType,
          defaultColor,
          showEmpty: rawText.trim() === '',
          scale: 2,
          wordSpacing,
          pageDate,
          pageNumber: 1,
          totalPages: pages.length,
          showHeader,
          textAlign,
        });
      } catch {
        const firstPage = container.querySelector<HTMLElement>('.a4-capture-page');
        if (!firstPage) return;
        canvas = await html2canvas(firstPage, {
          scale: 2, useCORS: true, logging: false,
          backgroundColor: PAPER_BG_COLORS[paperType],
        });
      }
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'writeify-handwriting.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Guarantee animation is visible for at least 3 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      setDownloading(false);
    }
  }, [defaultColor, font, fontSize, lineHeight, marginLeft, pages, paperType, rawText, wordSpacing, pageDate, showHeader]);

  const exportPDF = useCallback(async () => {
    const container = previewContainerRef.current;
    if (!container) return;
    setDownloading('pdf');
    await new Promise(r => setTimeout(r, 100)); // flush render so animation shows
    const startTime = Date.now();
    try {
      await waitForFonts();
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const fallbackPages = container.querySelectorAll<HTMLElement>('.a4-capture-page');
      for (let i = 0; i < pages.length; i++) {
        let canvas: HTMLCanvasElement;
        try {
          canvas = renderHandwritingCanvas(pages[i], {
            font,
            fontSize,
            marginLeft,
            lineHeight,
            paperType,
            defaultColor,
            showEmpty: i === 0 && rawText.trim() === '',
            scale: 2,
            wordSpacing,
            pageDate,
            pageNumber: i + 1,
            totalPages: pages.length,
            showHeader,
            textAlign,
          });
        } catch {
          const pageEl = fallbackPages[i];
          if (!pageEl) continue;
          canvas = await html2canvas(pageEl, {
            scale: 2, useCORS: true, logging: false,
            backgroundColor: PAPER_BG_COLORS[paperType],
          });
        }
        const imgData = canvas.toDataURL('image/png');
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, 0, pw, ph);
      }
      pdf.save('writeify-handwriting.pdf');
    } finally {
      // Guarantee animation is visible for at least 3 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      setDownloading(false);
    }
  }, [defaultColor, font, fontSize, lineHeight, marginLeft, pages, paperType, rawText, wordSpacing, pageDate, showHeader]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.22),transparent_34rem),radial-gradient(circle_at_top_right,rgba(168,85,247,0.18),transparent_30rem),linear-gradient(135deg,#f8fafc_0%,#eef2ff_45%,#f8fafc_100%)] text-slate-900">
      <ExportAnimation type={downloading} pageCount={pages.length} />

      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-white/60 bg-white/75 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 py-3.5 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-700 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/25 ring-1 ring-white/60 flex-shrink-0">
              <svg className="h-4 w-4 sm:h-5 sm:w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-black tracking-tight text-slate-950 leading-tight truncate">Writeify</div>
              <div className="text-xs text-slate-500 hidden sm:block">Premium multi-colour handwriting studio</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 p-1 text-xs sm:text-sm text-slate-600 shadow-sm flex-shrink-0">
            <Link to="/" className="rounded-full px-3 py-1.5 font-semibold text-slate-950 hover:bg-slate-100">Home</Link>
            <Link to="/faq" className="rounded-full px-3 py-1.5 hover:bg-slate-100 hover:text-slate-950">FAQ</Link>
            <Link to="/privacy" className="rounded-full px-3 py-1.5 hidden sm:inline hover:bg-slate-100 hover:text-slate-950">Privacy</Link>
            <Link to="/terms" className="rounded-full px-3 py-1.5 hidden sm:inline hover:bg-slate-100 hover:text-slate-950">Terms</Link>
            <Link to="/contact" className="rounded-full px-3 py-1.5 hover:bg-slate-100 hover:text-slate-950">Contact</Link>
          </nav>
        </div>
      </header>

      {/* Top Ad */}
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 pt-3">
        {adminSettings.adsEnabled && <AdBanner slot={adminSettings.adSlot1 || "1234567890"} format="leaderboard" className="max-w-3xl mx-auto" publisherId={adminSettings.publisherId} useRealAds={!!(adminSettings.adsEnabled && adminSettings.adSlot1 && adminSettings.publisherId && adminSettings.publisherId !== "ca-pub-XXXXXXXXXXXXXXXXX")} />}
      </div>

      <section className="max-w-screen-2xl mx-auto px-3 sm:px-6 pt-6">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/65 px-5 py-6 shadow-2xl shadow-indigo-950/10 backdrop-blur-2xl sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.28em] text-indigo-600">Handwriting Studio</p>
              <h1 className="max-w-3xl text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">
                Create clean, multi-colour handwritten pages with export-ready A4 precision.
              </h1>
            </div>
            <p className="max-w-sm text-sm leading-6 text-slate-600">
              Select any phrase, apply ink colours, choose a handwriting font, and preview every page below the controls on mobile.
            </p>
          </div>
        </div>
      </section>

      {/* MAIN LAYOUT */}
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 py-5 flex flex-col sm:flex-row gap-5 items-start">

        {/* LEFT CONTROLS PANEL */}
        <aside className="w-full sm:w-[410px] flex-shrink-0 space-y-4 flex flex-col">

          {/* Text Input Card */}
          <div className="rounded-[1.5rem] border border-white/75 bg-white/82 p-4 shadow-xl shadow-slate-950/5 backdrop-blur-2xl ring-1 ring-slate-950/[0.02]">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-black tracking-tight text-slate-950 text-sm flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.14)]" /> Text Input
              </h2>
              {clampedSpans.length > 0 && (
                <button onClick={() => setSpans([])} className="text-xs text-red-400 hover:text-red-600 underline transition-colors">
                  Clear all colors
                </button>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={rawText}
              onChange={handleTextChange}
              onSelect={captureSelection}
              onMouseUp={captureSelection}
              onKeyUp={captureSelection}
              placeholder="Type or paste text here. Highlight any portion, then click a color below!"
              className="w-full h-40 p-4 rounded-2xl border border-slate-200/80 font-mono text-sm resize-none bg-slate-950/[0.025] text-slate-900 placeholder:text-slate-400 shadow-inner shadow-slate-950/[0.03] focus:outline-none focus:ring-4 focus:ring-indigo-500/15 focus:border-indigo-400"
            />
            {/* Selection status */}
            <div className="mt-1.5 text-xs min-h-[18px]">
              {selectedText
                ? <span className="text-emerald-600 font-semibold">Selected: "{selectedText.length > 35 ? selectedText.slice(0, 35) + '…' : selectedText}"</span>
                : <span className="text-slate-400">Highlight text above to colour it</span>
              }
            </div>
            {/* Color buttons */}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {allColors.map(c => (
                <button
                  key={c.hex}
                  onClick={() => applyColor(c.hex as LineColor)}
                  disabled={!selectedText}
                  title={`${c.label}${!selectedText ? ' (select text first)' : ''}`}
                  style={{ borderColor: c.hex, backgroundColor: hexWithAlpha(c.hex, 0.1), color: c.hex }}
                  className={`px-3 py-1.5 rounded-full border text-xs font-black transition-all shadow-sm
                    ${selectedText ? 'hover:-translate-y-0.5 hover:shadow-md active:scale-95 cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Default Ink Color */}
          <div className="rounded-[1.5rem] border border-white/75 bg-white/82 p-4 shadow-xl shadow-slate-950/5 backdrop-blur-2xl ring-1 ring-slate-950/[0.02]">
            <h2 className="font-black tracking-tight text-slate-950 text-sm flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-purple-500 shadow-[0_0_0_4px_rgba(168,85,247,0.14)]" /> Default Ink Colour
            </h2>
            <div className="flex flex-wrap gap-3">
              {allColors.map(c => (
                <button
                  key={c.hex}
                  onClick={() => setDefaultColor(c.hex as LineColor)}
                  title={c.label}
                  style={{
                    backgroundColor: c.hex,
                    boxShadow: defaultColor === c.hex ? `0 0 0 3px white, 0 0 0 5px ${c.hex}` : '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                  className="w-8 h-8 rounded-full transition-all hover:scale-110 active:scale-95"
                />
              ))}
            </div>
          </div>

          {/* Font Settings */}
          <div className="rounded-[1.5rem] border border-white/75 bg-white/82 p-4 shadow-xl shadow-slate-950/5 backdrop-blur-2xl ring-1 ring-slate-950/[0.02]">
            <h2 className="font-black tracking-tight text-slate-950 text-sm flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.14)]" /> Font Settings
            </h2>
            <div className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Handwriting Font</label>
                <select value={font} onChange={e => setFont(e.target.value as FontFamily)}
                  className="w-full border border-slate-200/80 rounded-2xl px-3 py-2.5 text-sm text-slate-800 bg-white/90 shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/15 focus:border-indigo-400">
                  {allFonts.map(f => <option key={f.family} value={f.family}>{f.label}</option>)}
                </select>
                <div style={{ fontFamily: `'${font}', cursive`, fontSize: 18, color: defaultColor }}
                  className="mt-1.5 truncate pl-1">
                  The quick brown fox…
                </div>
              </div>


              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex justify-between mb-1">
                  <span>Font Size</span>
                  <span className="text-indigo-600 font-bold">{fontSize}px</span>
                </label>
                <input type="range" min={14} max={36} step={1} value={fontSize}
                  onChange={e => setFontSize(Number(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 rounded-full" />
                <div className="flex justify-between text-xs text-slate-400 mt-0.5"><span>14</span><span>36</span></div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex justify-between mb-1">
                  <span>Left Margin</span>
                  <span className="text-indigo-600 font-bold">{marginLeft}px</span>
                </label>
                <input type="range" min={0} max={120} step={4} value={marginLeft}
                  onChange={e => setMarginLeft(Number(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 rounded-full" />
                <div className="flex justify-between text-xs text-slate-400 mt-0.5"><span>0</span><span>120px</span></div>
              </div>

              {/* Word Spacing slider */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex justify-between mb-1">
                  <span>Word Spacing</span>
                  <span className="text-indigo-600 font-bold">{wordSpacing}px</span>
                </label>
                <input type="range" min={0} max={20} step={1} value={wordSpacing}
                  onChange={e => setWordSpacing(Number(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 rounded-full" />
                <div className="flex justify-between text-xs text-slate-400 mt-0.5"><span>0</span><span>20px</span></div>
              </div>

              {/* Text Alignment */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">Text Alignment</label>
                <div className="flex gap-2">
                  {(['left','center','right'] as const).map(a => (
                    <button key={a} onClick={() => setTextAlign(a)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-bold transition-all flex items-center justify-center gap-1.5
                        ${textAlign === a ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                      {a === 'left' && <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="10" height="1.5" rx="0.75"/><rect x="1" y="6.5" width="14" height="1.5" rx="0.75"/><rect x="1" y="10" width="8" height="1.5" rx="0.75"/><rect x="1" y="13.5" width="12" height="1.5" rx="0.75"/></svg>}
                      {a === 'center' && <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="1.5" rx="0.75"/><rect x="1" y="6.5" width="14" height="1.5" rx="0.75"/><rect x="4" y="10" width="8" height="1.5" rx="0.75"/><rect x="2" y="13.5" width="12" height="1.5" rx="0.75"/></svg>}
                      {a === 'right' && <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="3" width="10" height="1.5" rx="0.75"/><rect x="1" y="6.5" width="14" height="1.5" rx="0.75"/><rect x="7" y="10" width="8" height="1.5" rx="0.75"/><rect x="3" y="13.5" width="12" height="1.5" rx="0.75"/></svg>}
                      <span className="capitalize text-xs">{a}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Page Header toggle — works on all paper types */}
          <div className="rounded-[1.5rem] border border-white/75 bg-white/82 p-4 shadow-xl shadow-slate-950/5 backdrop-blur-2xl ring-1 ring-slate-950/[0.02]">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-black tracking-tight text-slate-950 text-sm flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-pink-500 shadow-[0_0_0_4px_rgba(236,72,153,0.14)]" /> Page Header
              </h2>
              {/* Toggle switch */}
              <button
                onClick={() => setShowHeader(h => !h)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showHeader ? 'bg-pink-500' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${showHeader ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Shows Date + auto Page number on every page</p>

            {showHeader && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Date</label>
                  <input
                    type="text"
                    value={pageDate}
                    onChange={e => setPageDate(e.target.value)}
                    placeholder="e.g. 07 June 2026"
                    className="w-full border border-slate-200/80 rounded-2xl px-3 py-2.5 text-sm text-slate-800 bg-white/90 shadow-sm focus:outline-none focus:ring-4 focus:ring-pink-500/15 focus:border-pink-400"
                  />
                </div>
                <div className="flex items-center gap-2 bg-pink-50 rounded-xl px-3 py-2">
                  <span className="text-pink-400 text-base">📄</span>
                  <p className="text-xs text-pink-700 font-medium">
                    Page numbers auto-count based on your text length — {pages.length} page{pages.length !== 1 ? 's' : ''} currently
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Paper Type */}
          <div className="rounded-[1.5rem] border border-white/75 bg-white/82 p-4 shadow-xl shadow-slate-950/5 backdrop-blur-2xl ring-1 ring-slate-950/[0.02]">
            <h2 className="font-black tracking-tight text-slate-950 text-sm flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]" /> Paper Type
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {PAPER_TYPES.map(pt => (
                <button key={pt.type} onClick={() => setPaperType(pt.type)}
                  className={`py-2.5 px-3 rounded-2xl border text-sm font-bold transition-all flex items-center gap-2
                    ${paperType === pt.type ? 'bg-slate-950 border-slate-950 text-white shadow-lg shadow-slate-950/15' : 'bg-white/80 border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/70'}`}>
                  <span>{pt.icon}</span>{pt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Export */}
          <div className="rounded-[1.5rem] border border-white/75 bg-slate-950 p-4 shadow-2xl shadow-slate-950/20 ring-1 ring-white/10">
            <h2 className="font-black tracking-tight text-white text-sm flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_0_4px_rgba(129,140,248,0.18)]" /> Export
            </h2>
            <div className="flex gap-2.5">
              <button onClick={exportPNG} disabled={!!downloading || !rawText.trim()}
                className="flex-1 py-3 rounded-2xl bg-white text-slate-950 hover:bg-indigo-50 font-black text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-lg shadow-black/20">
                {downloading === 'png'
                  ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>PNG…</>
                  : <>PNG</>}
              </button>
              <button onClick={exportPDF} disabled={!!downloading || !rawText.trim()}
                className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-400 hover:to-purple-400 font-black text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-950/30">
                {downloading === 'pdf'
                  ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>PDF…</>
                  : <>PDF</>}
              </button>
            </div>
            {!rawText.trim() && <p className="text-xs text-slate-400 mt-2 text-center">Enter text above to enable export</p>}
          </div>

          {/* Side Ad */}
          {adminSettings.adsEnabled && <AdBanner slot={adminSettings.adSlot2 || "0987654321"} format="rectangle" publisherId={adminSettings.publisherId} useRealAds={!!(adminSettings.adsEnabled && adminSettings.adSlot2 && adminSettings.publisherId && adminSettings.publisherId !== "ca-pub-XXXXXXXXXXXXXXXXX")} />}

          {/* Tip box */}
          <div className="rounded-[1.5rem] border border-amber-200/80 bg-amber-50/80 p-4 shadow-xl shadow-amber-900/5 backdrop-blur-xl">
            <p className="font-black text-amber-900 text-xs mb-1.5 uppercase tracking-wide">How to use</p>
            <ol className="list-decimal list-inside text-xs text-amber-800 space-y-1">
              <li>Type or paste your text in the box above</li>
              <li>Drag to highlight any portion of text</li>
              <li>Click a colour button to apply it</li>
              <li>Adjust font, size, margin &amp; paper style</li>
              <li>Download as PNG (first page) or multi-page PDF!</li>
            </ol>
          </div>
        </aside>

        {/* PREVIEW PANEL: sits below controls on mobile, beside them on desktop. */}
        <main className="w-full flex-1 min-w-0 rounded-[2rem] border border-white/70 bg-white/55 p-3 shadow-2xl shadow-slate-950/10 backdrop-blur-2xl sm:p-5">

          <div className="mb-4 flex flex-col gap-3 border-b border-slate-200/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-indigo-600">Live Preview</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">A4 handwriting paper</h2>
            </div>
            <div className="rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm">
              {pages.length} page{pages.length === 1 ? '' : 's'} · baseline locked
            </div>
          </div>

          {/* Color legend */}
          {clampedSpans.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {usedColors.map(color => {
                const info = allColors.find(c => c.hex === color);
                // Map common hex codes to friendly names
                const hexNames: Record<string, string> = {
                  '#ef4444': 'Red', '#2563eb': 'Blue', '#16a34a': 'Green',
                  '#000000': 'Black', '#1a1a1a': 'Black', '#1e40af': 'Blue',
                  '#c0392b': 'Red', '#15803d': 'Green', '#7e22ce': 'Purple',
                  '#c2410c': 'Orange', '#be185d': 'Pink', '#92400e': 'Brown',
                };
                const label = info?.label ?? hexNames[color.toLowerCase()] ?? null;
                if (!label) return null;
                return (
                  <span key={color}
                    style={{ backgroundColor: hexWithAlpha(color, 0.12), borderColor: color, color }}
                    className="px-2.5 py-0.5 rounded-full border text-xs font-bold">
                    ● {label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Multi-page preview */}
          <div
            ref={previewContainerRef}
            className="space-y-5 overflow-x-auto rounded-[1.5rem] bg-slate-950/[0.03] p-3 pb-4 ring-1 ring-slate-950/5 sm:p-5"
            style={{ maxWidth: '100%' }}
          >
            {pages.map((pageLines, pageIdx) => (
              <div key={pageIdx} className="pdf-page" style={{ width: A4_WIDTH_PX, display: 'inline-block' }}>
                {pages.length > 1 && (
                  <div className="text-xs text-slate-400 text-center mb-1 font-medium">
                    Page {pageIdx + 1} of {pages.length}
                  </div>
                )}
                <A4Page
                  pageLines={pageLines}
                  font={font}
                  fontSize={fontSize}
                  marginLeft={marginLeft}
                  lineHeight={lineHeight}
                  paperType={paperType}
                  pageNumber={pageIdx + 1}
                  totalPages={pages.length}
                  showEmpty={pageIdx === 0 && rawText.trim() === ''}
                  defaultColor={defaultColor}
                  wordSpacing={wordSpacing}
                  pageDate={pageDate}
                  onDateChange={pageIdx === 0 ? setPageDate : undefined}
                  showHeader={showHeader}
                  textAlign={textAlign}
                />
              </div>
            ))}
          </div>
{/* SEO Article */}
<div className="mt-10 max-w-3xl mx-auto px-2">
  <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-7 shadow-2xl text-white mb-6">
    <h2 className="text-2xl font-black mb-3">Text to Handwriting Converter</h2>
    <p className="text-slate-300 text-sm leading-relaxed">
      Writeify is the world's only free tool that converts typed text into
      beautiful multi-color handwriting — a feature no other tool offers.
      Choose fonts, paper styles, ink colors per word, and download as PNG or PDF instantly.
    </p>
  </div>
  <div className="space-y-6 text-slate-700">

    <section>
      <h3 className="text-lg font-black text-slate-900 mb-2">
        🌈 Multi-Color Handwriting — Only on Writeify
      </h3>
      <p className="text-sm leading-relaxed mb-3">
        No other handwriting tool in the world lets you assign different ink
        colors to different words in the same page. Writeify's unique
        color-span technology lets you highlight individual words or sentences
        in any color — black, blue, red, green, purple and more — all on a
        single page, exactly like a student who uses multiple pens.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: '🖊️', title: 'Per-Word Color', desc: 'Select any word and assign it a unique ink color' },
          { icon: '📄', title: 'Single Page', desc: 'All colors appear together on one realistic page' },
          { icon: '🎨', title: '8+ Colors', desc: 'Black, Blue, Red, Green, Purple, Orange, Pink, Brown' },
          { icon: '💾', title: 'Export Ready', desc: 'Colors preserved in PNG and PDF export' },
        ].map((f, i) => (
          <div key={i} className="p-3 bg-indigo-50 border border-indigo-100 rounded-2xl">
            <p className="text-xl mb-1">{f.icon}</p>
            <p className="font-bold text-slate-800 text-sm">{f.title}</p>
            <p className="text-slate-500 text-xs mt-0.5">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 className="text-lg font-black text-slate-900 mb-2">
        📅 Page Number & Date Header
      </h3>
      <p className="text-sm leading-relaxed mb-3">
        Writeify automatically adds a stylish Date and Page Number header
        to every page — just like a real notebook. No other online
        handwriting tool offers this. Enable it from the Page Header toggle,
        enter your date once, and every page gets auto-numbered 1, 2, 3…
        matching the length of your text. The header uses your selected
        handwriting font and ink color for a completely authentic look.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: '📅', title: 'Custom Date', desc: 'Type any date — shown on all pages' },
          { icon: '🔢', title: 'Auto Page No.', desc: 'Pages numbered automatically' },
          { icon: '✍️', title: 'Handwriting Font', desc: 'Header uses selected font & color' },
        ].map((f, i) => (
          <div key={i} className="p-3 bg-pink-50 border border-pink-100 rounded-2xl text-center">
            <p className="text-2xl mb-1">{f.icon}</p>
            <p className="font-bold text-slate-800 text-xs">{f.title}</p>
            <p className="text-slate-500 text-xs mt-0.5">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 className="text-lg font-black text-slate-900 mb-2">
        What is a Text to Handwriting Converter?
      </h3>
      <p className="text-sm leading-relaxed">
        A text to handwriting converter transforms your typed content into
        handwritten-style output on realistic notebook paper. Instead of
        writing pages by hand, simply type your content, choose a font,
        paper style, and ink color — then download as PNG or PDF.
        Writeify is the most advanced free handwriting converter available,
        with features like multi-color ink, double-rule paper, and
        automatic page numbering that no other tool provides.
      </p>
    </section>

    <section>
      <h3 className="text-lg font-black text-slate-900 mb-2">
        Why Students Love Writeify
      </h3>
      <ul className="space-y-2">
        {[
          '🌈 Multi-color handwriting on a single page — unique to Writeify',
          '📅 Auto page numbers and date header on every page',
          '✍️ 7 realistic handwriting fonts including Caveat, Kalam, Dancing Script',
          '📓 5 paper types — Double Rule, Lined, Plain, Grid, Cream',
          '📐 Adjustable font size, left margin, and word spacing',
          '↔️ Text alignment — Left, Center, or Right',
          '📥 Export as PNG image or multi-page PDF',
          '📱 Works on mobile, tablet, and desktop',
          '🔒 Text never leaves your device — 100% private',
          '✅ Completely free — no signup required',
        ].map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 flex-shrink-0">{item.split(' ')[0]}</span>
            <span>{item.split(' ').slice(1).join(' ')}</span>
          </li>
        ))}
      </ul>
    </section>

    <section>
      <h3 className="text-lg font-black text-slate-900 mb-2">
        How to Use Writeify
      </h3>
      <div className="space-y-3">
        {[
          { n: '1', t: 'Type or Paste Your Text', d: 'Enter any text — essays, notes, assignments. Long text splits automatically across multiple pages.' },
          { n: '2', t: 'Pick Colors Per Word', d: 'Select any word, tap a color button. That word gets its own ink color — unique to Writeify.' },
          { n: '3', t: 'Set Page Header', d: 'Enable the Date & Page Number header. Type your date once — all pages get it automatically.' },
          { n: '4', t: 'Choose Style', d: 'Select font, paper type, font size, margin, and word spacing to match your preference.' },
          { n: '5', t: 'Download PNG or PDF', d: 'Export instantly. PNG for single image, PDF for multi-page document with all formatting.' },
        ].map(s => (
          <div key={s.n} className="flex gap-4 p-4 bg-indigo-50 rounded-2xl">
            <div className="h-8 w-8 rounded-xl bg-indigo-600 text-white font-black flex items-center justify-center text-sm flex-shrink-0">{s.n}</div>
            <div>
              <p className="font-bold text-slate-800 text-sm">{s.t}</p>
              <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">{s.d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 className="text-lg font-black text-slate-900 mb-2">
        Paper Types Available
      </h3>
      <div className="space-y-2">
        {[
          { n: '📓 Double Rule', d: 'Classic Indian notebook with double margin lines and Date/Page header. Default paper on Writeify.' },
          { n: '📄 Lined', d: 'Standard ruled paper with blue lines and red margin. Most common for essays and notes.' },
          { n: '⬜ Plain', d: 'Clean white paper with no lines. Great for poems and creative writing.' },
          { n: '⊞ Grid', d: 'Graph paper style. Perfect for maths, science, and technical content.' },
          { n: '📜 Cream', d: 'Vintage warm-toned paper for an authentic, antique handwritten feel.' },
        ].map(p => (
          <div key={p.n} className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex gap-3 items-start">
            <span className="text-lg flex-shrink-0">{p.n.split(' ')[0]}</span>
            <div>
              <p className="font-bold text-slate-800 text-sm">{p.n.split(' ').slice(1).join(' ')}</p>
              <p className="text-slate-500 text-xs mt-0.5">{p.d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 className="text-lg font-black text-slate-900 mb-2">
        Frequently Asked Questions
      </h3>
      <div className="space-y-3">
        {[
          { q: 'Is Writeify free?', a: '100% free. No signup, no hidden charges, no download limits ever.' },
          { q: 'Can I use different colors for different words?', a: 'Yes — this is Writeify\'s unique feature. Select any word and assign it any ink color. Multiple colors appear on the same page.' },
          { q: 'Does it add page numbers automatically?', a: 'Yes. Enable Page Header and Writeify auto-numbers every page (1, 2, 3…) based on your text length.' },
          { q: 'Does it work on Android?', a: 'Yes. Writeify works perfectly on all Android browsers. No app download needed.' },
          { q: 'How many pages can I export?', a: 'Unlimited. Long text splits automatically across as many pages as needed, all exported as one PDF.' },
          { q: 'Is my text private?', a: 'Completely. All processing happens in your browser. Your text is never sent to any server.' },
        ].map((f, i) => (
          <div key={i} className="p-4 bg-white border border-slate-200 rounded-2xl">
            <p className="font-bold text-slate-800 text-sm mb-1">Q: {f.q}</p>
            <p className="text-slate-600 text-xs leading-relaxed">A: {f.a}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-3xl p-6 text-white text-center">
      <h3 className="text-lg font-black mb-2">
        The Only Handwriting Tool with Multi-Color Support
      </h3>
      <p className="text-white/80 text-sm mb-4">
        Free · Instant · No Signup · Works on Mobile
      </p>
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="bg-white text-indigo-600 font-black px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-50 transition-all">
        Try Writeify Now ↑
      </button>
    </section>

  </div>
</div>

          {/* Bottom Ad */}
          <div className="mt-5">
            {adminSettings.adsEnabled && <AdBanner slot={adminSettings.adSlot3 || "1122334455"} format="banner" publisherId={adminSettings.publisherId} useRealAds={!!(adminSettings.adsEnabled && adminSettings.adSlot3 && adminSettings.publisherId && adminSettings.publisherId !== "ca-pub-XXXXXXXXXXXXXXXXX")} />}
          </div>
        </main>
      </div>

      {/* FOOTER */}
      <AppFooter />
    </div>
  );
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function AppFooter() {
  return (
    <footer className="mt-10 border-t border-white/70 bg-white/65 py-8 shadow-[0_-10px_30px_rgba(15,23,42,0.04)] backdrop-blur-2xl">
      <div className="max-w-screen-xl mx-auto px-4 text-center text-sm text-slate-500">
        <p className="font-black tracking-tight text-slate-950 mb-1">Writeify</p>
        <p className="mb-3 text-xs">© {new Date().getFullYear()} All rights reserved · Mujeeb Wani</p>
        <div className="flex justify-center gap-4 flex-wrap text-xs">
          <Link to="/" className="font-semibold hover:text-indigo-600 transition-colors">Home</Link>
          <Link to="/privacy" className="font-semibold hover:text-indigo-600 transition-colors">Privacy Policy</Link>
          <Link to="/terms" className="font-semibold hover:text-indigo-600 transition-colors">Terms of Service</Link>
          <Link to="/faq" className="font-semibold hover:text-indigo-600 transition-colors">FAQ</Link>
          <Link to="/contact" className="font-semibold hover:text-indigo-600 transition-colors">Contact</Link>
        </div>
      </div>
    </footer>
  );
}

// ─── PAGE LAYOUT WRAPPER ──────────────────────────────────────────────────────
function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.2),transparent_32rem),linear-gradient(135deg,#f8fafc_0%,#eef2ff_50%,#f8fafc_100%)]">
      <header className="sticky top-0 z-50 border-b border-white/60 bg-white/75 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-700 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/25 ring-1 ring-white/60">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <span className="font-black tracking-tight text-slate-950 text-sm sm:text-base">Writeify</span>
          </Link>
          <nav className="flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 p-1 text-sm text-slate-600 shadow-sm">
            <Link to="/" className="rounded-full px-3 py-1.5 font-semibold hover:bg-slate-100 hover:text-slate-950">Home</Link>
            <Link to="/faq" className="rounded-full px-3 py-1.5 hover:bg-slate-100 hover:text-slate-950">FAQ</Link>
            <Link to="/privacy" className="rounded-full px-3 py-1.5 hidden sm:inline hover:bg-slate-100 hover:text-slate-950">Privacy</Link>
            <Link to="/terms" className="rounded-full px-3 py-1.5 hidden sm:inline hover:bg-slate-100 hover:text-slate-950">Terms</Link>
            <Link to="/contact" className="rounded-full px-3 py-1.5 hover:bg-slate-100 hover:text-slate-950">Contact</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">{children}</main>
      <AppFooter />
    </div>
  );
}

// ─── PRIVACY PAGE ─────────────────────────────────────────────────────────────
function PrivacyPage() {
  return (
    <PageLayout>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        <div className="mb-6">
          <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full mb-3">Legal</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">Privacy Policy</h1>
          <p className="text-slate-500 text-sm">Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="space-y-6 text-slate-700 text-sm leading-relaxed">
          {[
            { title: '1. Information We Collect', body: 'Writeify operates entirely in your browser. We do not collect, store, or transmit any text you enter into the tool. We may collect anonymous usage analytics including pages visited, time on site, browser type, device type, and geographic region (country level only).' },
            { title: '2. Cookies & Advertising', body: 'We use Google AdSense to display advertisements. Google may use cookies to serve ads based on your prior visits to our site. You can opt out of personalized advertising at google.com/settings/ads.' },
            { title: '3. Data Security', body: 'All text processing happens locally in your browser using JavaScript. Your handwriting output is generated and downloaded directly to your device. We never see, store, or have access to your text content.' },
            { title: '4. Third-Party Services', body: 'We use Google Fonts (to load handwriting fonts) and Google AdSense (to display relevant advertisements). Both services have their own privacy policies.' },
            { title: '5. Children\'s Privacy', body: 'Our service is not directed to children under 13. We do not knowingly collect personal information from children.' },
            { title: '6. Changes to This Policy', body: 'We may update this privacy policy from time to time and will notify users by updating the "Last updated" date above.' },
            { title: '7. Contact Us', body: 'If you have questions about this Privacy Policy, please contact us via our Contact page.' },
          ].map(section => (
            <section key={section.title}>
              <h2 className="text-base font-bold text-slate-800 mb-2">{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}

// ─── TERMS PAGE ───────────────────────────────────────────────────────────────
function TermsPage() {
  const sections = [
    { title: '1. Acceptance of Terms', body: 'By accessing and using Writeify, you accept and agree to be bound by these Terms of Service.' },
    { title: '2. Description of Service', body: 'Writeify is a free online tool that converts typed text into handwriting-style images and PDFs. The service is provided "as is" without warranty.' },
    { title: '3. Permitted Use', body: 'You may use this tool for personal, educational, and commercial purposes. You must not use it for unlawful purposes, to create forgeries, to attempt to impersonate signatures, or to reverse-engineer the service.' },
    { title: '4. Intellectual Property', body: 'The text you enter and the output you generate remains your own intellectual property. The tool itself, including its design and code, is owned by Mujeeb Wani.' },
    { title: '5. Disclaimer of Warranties', body: 'The service is provided without warranties of any kind. We make no guarantees about the accuracy, reliability, or availability of the service.' },
    { title: '6. Limitation of Liability', body: 'To the maximum extent permitted by law, Mujeeb Wani shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of this service.' },
    { title: '7. Governing Law', body: 'These terms are governed by applicable law. Any disputes shall be resolved through good-faith negotiation.' },
  ];
  return (
    <PageLayout>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        <div className="mb-6">
          <span className="inline-block bg-purple-100 text-purple-700 text-xs font-bold px-3 py-1 rounded-full mb-3">Legal</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">Terms of Service</h1>
          <p className="text-slate-500 text-sm">Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="space-y-5 text-slate-700 text-sm leading-relaxed">
          {sections.map(s => (
            <section key={s.title}>
              <h2 className="text-base font-bold text-slate-800 mb-1.5">{s.title}</h2>
              <p>{s.body}</p>
            </section>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}

// ─── FAQ PAGE ─────────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
  { q: 'Is this tool free to use?', a: 'Yes! Completely free. Convert text, apply multiple colours, and download as PNG or PDF with no cost or sign-up.' },
  { q: 'Does my text get stored on your servers?', a: 'No. All processing happens entirely in your browser. We never see or store your text content.' },
  { q: 'How do I apply different colours to different words?', a: 'Type your text, then click and drag to highlight a portion. Once selected (shown in the green status bar), click any colour button to assign it. Repeat for different sections!' },
  { q: 'What handwriting fonts are available?', a: 'Seven fonts: Caveat, Dancing Script, Homemade Apple, Sacramento, Shadows Into Light, Indie Flower, and Kalam. Each has a different character.' },
  { q: 'What paper types can I choose?', a: 'Four options: Lined (ruled notebook), Plain (blank white), Grid (graph paper), and Cream (vintage parchment background).' },
  { q: 'How does multi-page PDF export work?', a: 'Click "PDF". If your text spans more than one A4 page, the PDF automatically includes all pages as separate pages in a single file.' },
  { q: 'Why does text need to be on the lines?', a: 'The tool is designed so text baseline sits exactly on the ruled lines, just like real handwriting on notebook paper. Letters like g, p, q descend below the line naturally.' },
  { q: 'Can I adjust font size and margin?', a: 'Yes! The Font Settings card has sliders for font size (14–36px) and left margin (0–120px). Adjust them to your preference.' },
  { q: 'Is it mobile-friendly?', a: 'Yes! The app is fully responsive. On mobile, use the Controls/Preview tabs to switch between the editor and preview.' },
  { q: 'Is there a text length limit?', a: 'No hard limit. Long texts automatically paginate. Very long texts may take a moment to process during PDF export.' },
];

function FAQPage() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <PageLayout>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        <div className="mb-6">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full mb-3">Help</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">Frequently Asked Questions</h1>
          <p className="text-slate-500 text-sm">Everything you need to know about Writeify</p>
        </div>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
              <button onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left font-semibold text-slate-800 text-sm hover:bg-slate-50 transition-colors gap-3">
                <span>{item.q}</span>
                <span className={`text-indigo-500 text-xs transition-transform flex-shrink-0 ${open === i ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {open === i && (
                <div className="px-4 pb-4 pt-2 text-slate-600 text-sm leading-relaxed border-t border-slate-100 bg-slate-50">{item.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}

// ─── CONTACT PAGE ─────────────────────────────────────────────────────────────
function ContactPage() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [siteSettings, setSiteSettings] = useState<import('./types').AdminSettings>(DEFAULT_ADMIN);
  useEffect(() => { fetchPublicSettings().then(s => { if (s) setSiteSettings(s); }); }, []);
  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <PageLayout>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        <div className="mb-6">
          <span className="inline-block bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full mb-3">Get in Touch</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">Contact Us</h1>
          <p className="text-slate-500 text-sm">Have a question, suggestion, or feedback? We'd love to hear from you.{siteSettings.supportEmail ? <> Email us at <a href={`mailto:${siteSettings.supportEmail}`} className="text-indigo-600 font-semibold hover:underline">{siteSettings.supportEmail}</a></> : null}</p>
        </div>
        {sent ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-xl font-bold text-green-800 mb-1">Message Sent!</h2>
            <p className="text-green-700 text-sm">Thank you for reaching out. We'll get back to you within 24–48 hours.</p>
            <button onClick={() => { setSent(false); setForm({ name: '', email: '', subject: '', message: '' }); }}
              className="mt-4 px-5 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors">
              Send Another
            </button>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); setSent(true); }} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Your Name *</label>
                <input required name="name" value={form.name} onChange={handle} placeholder="John Doe"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Email Address *</label>
                <input required type="email" name="email" value={form.email} onChange={handle} placeholder="john@example.com"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Subject *</label>
              <select required name="subject" value={form.subject} onChange={handle}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                <option value="">Select a subject…</option>
                <option>General Question</option>
                <option>Bug Report</option>
                <option>Feature Request</option>
                <option>Advertising Inquiry</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Message *</label>
              <textarea required name="message" value={form.message} onChange={handle} rows={5}
                placeholder="Describe your question or feedback in detail…"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white resize-none" />
            </div>
            <button type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm text-sm">
              Send Message →
            </button>
          </form>
        )}
      </div>
    </PageLayout>
  );
}

// ─── SUPABASE HELPERS (admin settings sync only — no user accounts) ──────────
const SB_TABLE = 'admin_settings';

async function sbFetch(url: string, key: string, path: string, method = 'GET', body?: object) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return method === 'GET' ? res.json() : res;
}

async function pushSettingsToSupabase(url: string, key: string, settings: import('./types').AdminSettings) {
  for (const [k, v] of Object.entries(settings)) {
    await sbFetch(url, key, SB_TABLE, 'POST', { key: k, value: typeof v === 'string' ? v : JSON.stringify(v) });
  }
}

async function pullSettingsFromSupabase(url: string, key: string): Promise<Partial<import('./types').AdminSettings>> {
  const rows: { key: string; value: string }[] = await sbFetch(url, key, `${SB_TABLE}?select=key,value`);
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
  }
  return result as Partial<import('./types').AdminSettings>;
}

// ─── SUPABASE TAB ─────────────────────────────────────────────────────────────
function SupabaseTab({ settings, setSettings, save }: {
  settings: import('./types').AdminSettings;
  setSettings: React.Dispatch<React.SetStateAction<import('./types').AdminSettings>>;
  save: (patch: Partial<import('./types').AdminSettings>, msg?: string) => void;
}) {
  const [sbUrl, setSbUrl] = useState(settings.supabaseUrl || '');
  const [sbKey, setSbKey] = useState(settings.supabaseAnonKey || '');
  const [status, setStatus] = useState<'idle'|'busy'|'ok'|'error'>('idle');
  const [msg, setMsg] = useState('');

  const isConnected = !!(settings.supabaseUrl && settings.supabaseAnonKey);

  const setResult = (ok: boolean, m: string) => { setStatus(ok ? 'ok' : 'error'); setMsg(m); };

  const testConn = async () => {
    if (!sbUrl || !sbKey) { setResult(false, 'Enter URL and key first.'); return; }
    setStatus('busy'); setMsg('Testing connection...');
    try {
      await sbFetch(sbUrl, sbKey, `${SB_TABLE}?select=key&limit=1`);
      setResult(true, '✅ Connected successfully!');
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setResult(false, m.includes('42P01') ? '⚠️ Connected — but run SQL schema first (see Step 2).' : `❌ ${m}`);
    }
  };

  const pushAll = async () => {
    setStatus('busy'); setMsg('Pushing all settings to Supabase...');
    try {
      await pushSettingsToSupabase(settings.supabaseUrl, settings.supabaseAnonKey, settings);
      setResult(true, '✅ All admin settings pushed to Supabase cloud!');
    } catch (e: unknown) { setResult(false, `❌ ${e instanceof Error ? e.message : e}`); }
  };

  const pullAll = async () => {
    setStatus('busy'); setMsg('Pulling settings from Supabase...');
    try {
      const remote = await pullSettingsFromSupabase(settings.supabaseUrl, settings.supabaseAnonKey);
      const merged = { ...settings, ...remote };
      setSettings(merged);
      saveAdminSettings(merged);
      setResult(true, '✅ Settings pulled and applied!');
    } catch (e: unknown) { setResult(false, `❌ ${e instanceof Error ? e.message : e}`); }
  };

  const Inp = ({ label, value, onChange, ph, hint, pw }: { label: string; value: string; onChange: (v: string) => void; ph?: string; hint?: string; pw?: boolean }) => (
    <div>
      <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">{label}</label>
      <input type={pw ? 'password' : 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={ph}
        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white font-mono" />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-bold text-slate-800 text-lg">🗄️ Supabase — Admin Settings Cloud Sync</h2>
        <p className="text-sm text-slate-500 mt-1">Saves your admin panel settings to Supabase cloud so they persist across devices and browser clears. <strong>No user signup needed</strong> — admin only.</p>
      </div>

      {msg && (
        <div className={`p-3 rounded-xl text-sm font-medium border flex items-center gap-2 ${status === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : status === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
          {status === 'busy' && <svg className="animate-spin h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
          {msg}
        </div>
      )}

      {/* Step 1 */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">① Enter Supabase Credentials</p>
        <Inp label="Project URL" value={sbUrl} onChange={setSbUrl} ph="https://xxxxxxxxxxxx.supabase.co" hint="Supabase → Project Settings → API → Project URL" />
        <Inp label="Anon / Public Key" value={sbKey} onChange={setSbKey} pw ph="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." hint="Supabase → Project Settings → API → anon public" />
        <div className="flex gap-2">
          <button onClick={() => save({ supabaseUrl: sbUrl, supabaseAnonKey: sbKey }, 'Credentials saved!')}
            className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-sm">Save</button>
          <button onClick={testConn}
            className="flex-1 py-2.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-bold rounded-xl text-sm">Test Connection</button>
        </div>
      </div>

      {/* Step 2 — SQL */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">② Run SQL Schema (one time)</p>
        <p className="text-xs text-slate-500">Open <code className="bg-slate-100 px-1 rounded">supabase_schema.sql</code> from the zip → paste into <strong>Supabase → SQL Editor → Run ▶</strong></p>
        <div className="p-3 bg-slate-900 rounded-xl text-xs text-green-400 font-mono">
          Creates: admin_settings table with key/value rows
        </div>
      </div>

      {/* Step 3 — Push / Pull */}
      <div className={`border rounded-xl p-4 space-y-3 transition-all ${isConnected ? 'border-green-200' : 'border-slate-200 opacity-50 pointer-events-none'}`}>
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">③ Sync Your Settings</p>
        {isConnected && <p className="text-xs text-green-700 font-mono">✅ {settings.supabaseUrl}</p>}
        <div className="flex gap-2">
          <button onClick={pushAll}
            className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm">
            ⬆️ Push to Cloud
          </button>
          <button onClick={pullAll}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm">
            ⬇️ Pull from Cloud
          </button>
        </div>
        <p className="text-xs text-slate-500"><strong>Push</strong> → saves everything to Supabase. <strong>Pull</strong> → loads on a new device.</p>
      </div>

      {/* What syncs */}
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
        <p className="text-xs font-bold text-slate-700 mb-2">📦 Everything that syncs:</p>
        <div className="grid grid-cols-2 gap-y-1 text-xs text-slate-500">
          {['Publisher ID','Ad Slot 1/2/3','Ad Network Script','Ad Meta Tag','Site Name','Description','Keywords','OG Title','OG Description','Analytics ID','Custom Fonts','Custom Colors','Admin Password'].map(i => (
            <span key={i} className="flex items-center gap-1"><span className="text-green-500">✓</span>{i}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN PAGE ───────────────────────────────────────────────────────────────
// Supabase credentials stored ONLY in localStorage (never synced — browser only)
const SB_CREDS_KEY = 'writeify_sb_creds';
// Admin password stored ONLY in localStorage (never synced — security)
const ADMIN_PW_KEY = 'writeify_admin_pw';

const DEFAULT_ADMIN: import('./types').AdminSettings = {
  password: 'Saaki008@@',
  publisherId: 'ca-pub-7120952836131032',
  adSlot1: '',
  adSlot2: '',
  adSlot3: '',
  siteName: 'Writeify',
  siteDescription: 'Convert your text to beautiful handwriting with multiple colors, fonts, and paper styles.',
  siteKeywords: 'text to handwriting, handwriting converter, handwriting generator',
  siteAuthor: 'Writeify',
  ogTitle: 'Writeify - Text to Handwriting',
  ogDescription: 'Convert text to beautiful multi-color handwriting. Download as PNG or PDF.',
  analyticsId: '',
  customFonts: [],
  customColors: [],
  supabaseUrl: '',
  supabaseAnonKey: '',
  adNetworkScript: '',
  adNetworkMeta: '',
  supportEmail: 'support@writeify.online',
  adsEnabled: false,
  siteDomain: 'writeify.online',
};

// ── Supabase REST helpers (no SDK) ────────────────────────────────────────────

// PUBLIC Supabase credentials — hardcoded so ALL visitors can read site settings.
// The anon/public key is safe to expose in client-side code (it's read-only by design).
// Update these two values to match your Supabase project.
const PUBLIC_SUPABASE_URL = 'https://ingmrcsjmydxqmpswfae.supabase.co';
const PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZ21yY3NqbXlkeHFtcHN3ZmFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDE4OTksImV4cCI6MjA5NjQxNzg5OX0.7MsQoABUxwu1LIX38fa6pX0IjozMeKjaj6PweQu58pc';

function getSupaCreds(): { url: string; key: string } | null {
  // 1. Admin's browser-stored creds (set via admin panel Connection tab)
  try {
    const raw = localStorage.getItem(SB_CREDS_KEY);
    if (raw) {
      const { url, key } = JSON.parse(raw);
      if (url && key) return { url, key };
    }
  } catch { /* fall through */ }
  // 2. Hardcoded public credentials — used by every visitor automatically
  if (PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY) {
    return { url: PUBLIC_SUPABASE_URL, key: PUBLIC_SUPABASE_ANON_KEY };
  }
  return null;
}

function saveSupaCreds(url: string, key: string) {
  localStorage.setItem(SB_CREDS_KEY, JSON.stringify({ url, key }));
}

function getAdminPw(): string {
  return localStorage.getItem(ADMIN_PW_KEY) || DEFAULT_ADMIN.password;
}

function saveAdminPw(pw: string) {
  localStorage.setItem(ADMIN_PW_KEY, pw);
}

async function supaFetch(
  path: string, method: string, key: string, url: string, body?: unknown
): Promise<Response> {
  return fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'resolution=merge-duplicates' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Fetch all public settings from Supabase — called by EVERY visitor on load
async function fetchPublicSettings(): Promise<import('./types').AdminSettings | null> {
  const creds = getSupaCreds();
  if (!creds) return null;
  try {
    const res = await supaFetch('site_settings?select=key,value', 'GET', creds.key, creds.url);
    if (!res.ok) return null;
    const rows: { key: string; value: string }[] = await res.json();
    const patch: Record<string, unknown> = {};
    for (const row of rows) {
      try { patch[row.key] = JSON.parse(row.value); }
      catch { patch[row.key] = row.value; }
    }
    return { ...DEFAULT_ADMIN, ...patch } as import('./types').AdminSettings;
  } catch { return null; }
}

// Save a batch of settings to Supabase (admin only)
async function pushToSupabase(
  patch: Partial<Omit<import('./types').AdminSettings, 'password' | 'supabaseUrl' | 'supabaseAnonKey'>>,
  creds: { url: string; key: string }
): Promise<boolean> {
  try {
    const rows = Object.entries(patch).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      updated_at: new Date().toISOString(),
    }));
    const res = await supaFetch('site_settings', 'POST', creds.key, creds.url, rows);
    return res.ok;
  } catch { return false; }
}

// ── UploadFontSection — Upload TTF/OTF/WOFF/WOFF2 custom fonts ────────────────
function UploadFontSection({
  settings,
  save,
}: {
  settings: import('./types').AdminSettings;
  save: (patch: Partial<import('./types').AdminSettings>, msg?: string) => void;
}) {
  const [uploadLabel, setUploadLabel] = React.useState('');
  const [uploadFamily, setUploadFamily] = React.useState('');
  const [uploadStatus, setUploadStatus] = React.useState<string>('');
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const FONT_MIME: Record<string, string> = {
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };
  const FORMAT_MAP: Record<string, 'truetype' | 'opentype' | 'woff' | 'woff2'> = {
    ttf: 'truetype',
    otf: 'opentype',
    woff: 'woff',
    woff2: 'woff2',
  };

  // Detect the true font format from the first 4 magic bytes of the file buffer.
  // Calligraphr exports fonts with a .otf extension but TTF (TrueType) internals,
  // so relying on the file extension alone produces a wrong format('opentype')
  // declaration that browsers silently reject.
  //   00 01 00 00  →  TrueType / TTF
  //   4F 54 54 4F  →  OpenType CFF ("OTTO")
  //   77 4F 46 46  →  WOFF
  //   77 4F 46 32  →  WOFF2
  const detectFontFormat = (buffer: ArrayBuffer): 'truetype' | 'opentype' | 'woff' | 'woff2' => {
    const bytes = new Uint8Array(buffer, 0, 4);
    const magic = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    if (magic === '774f4646') return 'woff';
    if (magic === '774f4632') return 'woff2';
    if (magic === '4f54544f') return 'opentype'; // "OTTO" = CFF OpenType
    return 'truetype'; // 00010000 or any other = TrueType
  };

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setUploadStatus('❌ Please choose a font file first.'); return; }
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
      setUploadStatus('❌ Only TTF, OTF, WOFF, WOFF2 files are supported.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setUploadStatus('❌ Font file must be under 3 MB.');
      return;
    }
    const family = uploadFamily.trim() || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const label = uploadLabel.trim() || family;
    if (!family) { setUploadStatus('❌ Please enter a font family name.'); return; }

    setUploading(true);
    setUploadStatus('⏳ Reading font file…');

    // First read as ArrayBuffer to detect true format from magic bytes,
    // then re-read as DataURL for storage.
    const bufReader = new FileReader();
    bufReader.onload = (bufEv) => {
      const detectedFormat = detectFontFormat(bufEv.target?.result as ArrayBuffer);
      const reader = new FileReader();
      reader.onload = async (ev) => {
        // Replace the MIME type in the data URL to match the detected format
        // so the @font-face src is always correct regardless of file extension.
        const rawDataUrl = ev.target?.result as string;
        const mimeForFormat: Record<string, string> = {
          truetype: 'font/ttf',
          opentype: 'font/otf',
          woff: 'font/woff',
          woff2: 'font/woff2',
        };
        const base64 = rawDataUrl.replace(
          /^data:[^;]+;base64,/,
          `data:${mimeForFormat[detectedFormat]};base64,`
        );
        // Inject @font-face immediately for admin preview
        const styleId = `custom-font-${family.replace(/\s+/g, '-')}`;
        const existingStyle = document.getElementById(styleId);
        if (existingStyle) existingStyle.remove(); // remove stale preview style if re-uploading
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `@font-face { font-family: '${family}'; src: url('${base64}') format('${detectedFormat}'); font-display: swap; }`;
        document.head.appendChild(style);
        const newEntry: import('./types').FontInfo = {
          family,
          label,
          src: base64,
          format: detectedFormat,
        };
        const updated = [...(settings.customFonts || []), newEntry];
        await save({ customFonts: updated }, `Font "${label}" uploaded — live for all visitors!`);
        setUploadStatus(`✅ "${label}" added! It will load for every visitor automatically.`);
        setUploadLabel('');
        setUploadFamily('');
        if (fileRef.current) fileRef.current.value = '';
        setUploading(false);
      };
      reader.onerror = () => {
        setUploadStatus('❌ Failed to read font file. Please try again.');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    };
    bufReader.onerror = () => {
      setUploadStatus('❌ Failed to read font file. Please try again.');
      setUploading(false);
    };
    bufReader.readAsArrayBuffer(file);
  };

  return (
    <div className="border border-dashed border-violet-300 rounded-xl p-4 space-y-3 bg-violet-50/40">
      <p className="text-sm font-bold text-violet-800">🖋️ Upload Custom Calligraphy Font</p>
      <p className="text-xs text-violet-600">Supports TTF, OTF, WOFF, WOFF2 — stored in Supabase, loads for every visitor automatically.</p>

      <div>
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Font File</label>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f && !uploadFamily) {
              setUploadFamily(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
              setUploadLabel(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
            }
          }}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <p className="text-xs text-slate-400 mt-1">Max 3 MB. Larger fonts may slow page load.</p>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Font Family Name <span className="text-slate-400">(used internally)</span></label>
        <input
          value={uploadFamily}
          onChange={e => setUploadFamily(e.target.value)}
          placeholder="e.g. MyCalligraphy"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
      </div>

      <div>
        <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Display Label <span className="text-slate-400">(shown in font picker)</span></label>
        <input
          value={uploadLabel}
          onChange={e => setUploadLabel(e.target.value)}
          placeholder="e.g. My Calligraphy"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
      </div>

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-xl px-4 py-2.5 text-sm transition-colors"
      >
        {uploading ? '⏳ Uploading…' : '📤 Upload Font → Live for Everyone'}
      </button>

      {uploadStatus && (
        <p className={`text-xs rounded-xl p-3 ${uploadStatus.startsWith('✅') ? 'bg-green-50 text-green-700' : uploadStatus.startsWith('⏳') ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
          {uploadStatus}
        </p>
      )}

      {/* Preview uploaded font */}
      {uploadFamily && (
        <div className="bg-white border border-violet-100 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-400 mb-1">Preview (after upload):</p>
          <p style={{ fontFamily: `'${uploadFamily}', cursive` }} className="text-2xl text-slate-800">
            Aa Bb Cc — {uploadLabel || uploadFamily}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Admin Page Component ───────────────────────────────────────────────────────
type AdminTab = 'connection' | 'ads' | 'site' | 'fonts' | 'colors' | 'security';

function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('connection');
  const [settings, setSettings] = useState<import('./types').AdminSettings>(DEFAULT_ADMIN);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Local form states for each tab
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [newFontFamily, setNewFontFamily] = useState('');
  const [newFontLabel, setNewFontLabel] = useState('');
  const [newColorHex, setNewColorHex] = useState('#000000');
  const [newColorLabel, setNewColorLabel] = useState('');

  const isConnected = !!getSupaCreds();

  const flash = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // On auth, load current settings from Supabase
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== getAdminPw()) { setLoginError('Incorrect password.'); return; }
    setAuthed(true); setLoginError('');
    const creds = getSupaCreds();
    if (creds) { setSbUrl(creds.url); setSbKey(creds.key); }
    setLoading(true);
    const s = await fetchPublicSettings();
    if (s) setSettings(s);
    setLoading(false);
  };

  // Save a patch to Supabase + update local state
  const save = async (
    patch: Partial<Omit<import('./types').AdminSettings, 'password' | 'supabaseUrl' | 'supabaseAnonKey'>>,
    label = 'Saved!'
  ) => {
    const creds = getSupaCreds();
    if (!creds) { flash('Connect Supabase first (Connection tab)', false); return; }
    setLoading(true);
    const ok = await pushToSupabase(patch, creds);
    setLoading(false);
    if (ok) {
      setSettings(s => ({ ...s, ...patch }));
      flash(label);
    } else {
      flash('Save failed — check Supabase connection', false);
    }
  };

  const Field = ({
    label, value, onChange, type = 'text', placeholder = '', hint = '',
  }: {
    label: string; value: string; onChange: (v: string) => void;
    type?: string; placeholder?: string; hint?: string;
  }) => (
    <div>
      <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">{label}</label>
      {type === 'textarea' ? (
        <textarea value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} rows={3}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white font-mono resize-none" />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
      )}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );

  const Btn = ({
    onClick, children, color = 'indigo', full = true, disabled = false,
  }: {
    onClick: () => void; children: React.ReactNode;
    color?: 'indigo' | 'green' | 'red' | 'slate' | 'blue';
    full?: boolean; disabled?: boolean;
  }) => {
    const map: Record<string, string> = {
      indigo: 'bg-indigo-600 hover:bg-indigo-700',
      green: 'bg-green-600 hover:bg-green-700',
      red: 'bg-red-600 hover:bg-red-700',
      slate: 'bg-slate-700 hover:bg-slate-800',
      blue: 'bg-blue-600 hover:bg-blue-700',
    };
    return (
      <button onClick={onClick} disabled={disabled || loading}
        className={`${full ? 'w-full' : ''} py-2.5 px-4 ${map[color]} disabled:opacity-40 text-white font-bold rounded-xl transition-all text-sm`}>
        {loading ? '⏳ Saving…' : children}
      </button>
    );
  };

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: 'connection', label: 'Connection', icon: '🔌' },
    { id: 'ads',        label: 'Ad Network', icon: '📢' },
    { id: 'site',       label: 'Site Info',  icon: '🌐' },
    { id: 'fonts',      label: 'Fonts',      icon: '✍️' },
    { id: 'colors',     label: 'Colors',     icon: '🎨' },
    { id: 'security',   label: 'Security',   icon: '🔒' },
  ];

  if (!authed) {
    return (
      <PageLayout>
        <div className="max-w-sm mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="text-center mb-7">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center mx-auto mb-3 text-2xl shadow-lg">🔐</div>
              <h1 className="text-xl font-bold text-slate-900">Admin Panel</h1>
              <p className="text-slate-500 text-sm mt-1">Writeify Control Center</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Password</label>
                <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              {loginError && <p className="text-red-500 text-xs font-medium">{loginError}</p>}
              <button type="submit"
                className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl transition-all text-sm">
                Login →
              </button>
            </form>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">⚙️ Admin Panel</h1>
            <p className="text-slate-500 text-sm">
              {isConnected ? '🟢 Supabase connected — changes go live for all visitors' : '🔴 Not connected — connect Supabase first'}
            </p>
          </div>
          <button onClick={() => setAuthed(false)}
            className="text-xs text-slate-500 hover:text-red-500 border border-slate-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-all">
            Logout
          </button>
        </div>

        {/* Status banner */}
        {statusMsg && (
          <div className={`rounded-xl px-4 py-3 mb-5 text-sm font-semibold flex items-center gap-2 ${statusMsg.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {statusMsg.ok ? '✅' : '❌'} {statusMsg.text}
          </div>
        )}

        {!isConnected && activeTab !== 'connection' && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800 font-medium">
            ⚠️ Supabase not connected. Go to <button onClick={() => setActiveTab('connection')} className="underline font-bold">Connection tab</button> to connect first. All changes will save to Supabase so every visitor sees them.
          </div>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-5">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${activeTab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">

          {/* ══ CONNECTION TAB ══ */}
          {activeTab === 'connection' && (
            <div className="space-y-5">
              <h2 className="font-bold text-slate-800 text-lg">🔌 Supabase Connection</h2>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
                <strong>How it works:</strong> Every setting you change in this admin panel is saved directly to Supabase. Every visitor who opens writeify.online fetches settings fresh from Supabase — so your changes go live for <strong>everyone instantly</strong>. No redeploy needed.
              </div>

              <Field label="Supabase Project URL" value={sbUrl} onChange={setSbUrl}
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                hint="Supabase → Project Settings → API → Project URL" />
              <Field label="Supabase Anon / Public Key" value={sbKey} onChange={setSbKey}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                hint="Supabase → Project Settings → API → anon/public key" />

              <div className="flex gap-3">
                <Btn color="green" onClick={async () => {
                  if (!sbUrl || !sbKey) { flash('Enter both URL and key', false); return; }
                  setLoading(true);
                  const res = await supaFetch('site_settings?select=key&limit=1', 'GET', sbKey, sbUrl).catch(() => null);
                  setLoading(false);
                  if (!res || !res.ok) {
                    flash('Connection failed — make sure you ran the SQL schema in Supabase', false);
                    return;
                  }
                  saveSupaCreds(sbUrl, sbKey);
                  const s = await fetchPublicSettings();
                  if (s) setSettings(s);
                  flash('✅ Supabase connected! All settings now sync live to every visitor.');
                }}>
                  Connect & Test →
                </Btn>
                {isConnected && (
                  <Btn color="red" full={false} onClick={() => {
                    localStorage.removeItem(SB_CREDS_KEY);
                    setSbUrl(''); setSbKey('');
                    flash('Disconnected from Supabase', false);
                  }}>
                    Disconnect
                  </Btn>
                )}
              </div>

              {isConnected && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 font-semibold">
                  🟢 Connected: {getSupaCreds()?.url}
                </div>
              )}

              <div className="p-4 bg-slate-900 rounded-xl">
                <p className="text-xs text-slate-300 font-bold mb-2">📋 Setup (one time only):</p>
                <pre className="text-xs text-green-400 whitespace-pre-wrap">{`1. supabase.com → Create new project
2. SQL Editor → New Query
3. Paste the supabase_schema.sql file → Run
4. Project Settings → API → copy URL + anon key
5. Paste above → Connect & Test
6. Done! Every admin change now updates live ✅`}</pre>
              </div>
            </div>
          )}

          {/* ══ ADS TAB ══ */}
          {activeTab === 'ads' && (
            <div className="space-y-5">
              <h2 className="font-bold text-slate-800 text-lg">📢 Ad Network</h2>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
                Changes save to Supabase → go live for <strong>all visitors immediately</strong>. No redeploy needed.
              </div>

              {/* Master ads toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="font-bold text-slate-800 text-sm">Ads Enabled</p>
                  <p className="text-xs text-slate-500 mt-0.5">Turn off to hide all ads from visitors</p>
                </div>
                <button
                  onClick={() => setSettings(s => ({ ...s, adsEnabled: !s.adsEnabled }))}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${settings.adsEnabled ? 'bg-green-500' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${settings.adsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <Field label="Publisher / Client ID"
                value={settings.publisherId}
                onChange={v => setSettings(s => ({ ...s, publisherId: v }))}
                placeholder="ca-pub-XXXXXXXXXXXXXXXXX"
                hint="Google AdSense publisher ID" />
              <Field label="Ad Slot 1 — Top Leaderboard"
                value={settings.adSlot1}
                onChange={v => setSettings(s => ({ ...s, adSlot1: v }))}
                placeholder="1234567890" />
              <Field label="Ad Slot 2 — Sidebar Rectangle"
                value={settings.adSlot2}
                onChange={v => setSettings(s => ({ ...s, adSlot2: v }))}
                placeholder="0987654321" />
              <Field label="Ad Slot 3 — Bottom Banner"
                value={settings.adSlot3}
                onChange={v => setSettings(s => ({ ...s, adSlot3: v }))}
                placeholder="1122334455" />
              <Field label="Ad Network Script Tag"
                value={settings.adNetworkScript}
                onChange={v => setSettings(s => ({ ...s, adNetworkScript: v }))}
                type="textarea"
                placeholder={'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXX" crossorigin="anonymous"></script>'}
                hint="Full <script> tag from any ad network (AdSense, Media.net, Ezoic…)" />
              <Field label="Ad Verification Meta Tag (optional)"
                value={settings.adNetworkMeta}
                onChange={v => setSettings(s => ({ ...s, adNetworkMeta: v }))}
                type="textarea"
                placeholder='<meta name="google-adsense-account" content="ca-pub-XXXX" />'
                hint="Some networks require a meta tag in <head>" />

              <Btn color="green" onClick={() => save({
                adsEnabled: settings.adsEnabled,
                publisherId: settings.publisherId,
                adSlot1: settings.adSlot1,
                adSlot2: settings.adSlot2,
                adSlot3: settings.adSlot3,
                adNetworkScript: settings.adNetworkScript,
                adNetworkMeta: settings.adNetworkMeta,
              }, '✅ Ad settings saved — live for all visitors!')}>
                Save Ad Settings → Live for Everyone
              </Btn>

              {/* Status */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs font-bold text-slate-600 mb-3 uppercase tracking-wide">Current Status</p>
                {[
                  { label: 'Ads Toggle', val: settings.adsEnabled ? '🟢 ENABLED' : '🔴 DISABLED' },
                  { label: 'Publisher ID', val: settings.publisherId },
                  { label: 'Ad Slot 1', val: settings.adSlot1 },
                  { label: 'Ad Slot 2', val: settings.adSlot2 },
                  { label: 'Ad Slot 3', val: settings.adSlot3 },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-xs text-slate-500">{row.label}</span>
                    <span className={`text-xs font-mono font-bold ${row.val && row.val !== 'ca-pub-XXXXXXXXXXXXXXXXX' && row.val !== '🔴 DISABLED' ? 'text-green-600' : 'text-red-400'}`}>
                      {row.val && row.val !== 'ca-pub-XXXXXXXXXXXXXXXXX' ? row.val : '⚠️ Not set'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ SITE INFO TAB ══ */}
          {activeTab === 'site' && (
            <div className="space-y-5">
              <h2 className="font-bold text-slate-800 text-lg">🌐 Site Info & SEO</h2>

              {/* Domain Management */}
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-3">
                <p className="text-sm font-bold text-indigo-800">🌍 Domain Management</p>
                <p className="text-xs text-indigo-600">Change your domain any time. No redeploy needed — just update DNS and paste new domain here.</p>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Current Domain</label>
                  <input
                    value={settings.siteDomain || ''}
                    onChange={e => setSettings(s => ({ ...s, siteDomain: e.target.value }))}
                    placeholder="writeify.online"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                  />
                  <p className="text-xs text-slate-400 mt-1">Without https:// — just the domain e.g. writeify.online</p>
                </div>
                <Btn color="indigo" onClick={() => save({ siteDomain: settings.siteDomain }, '✅ Domain saved!')}>
                  Save Domain
                </Btn>
                <div className="text-xs text-indigo-700 bg-white rounded-xl p-3 border border-indigo-100">
                  <p className="font-bold mb-1">To switch domains:</p>
                  <p>1. Connect new domain DNS to Cloudflare</p>
                  <p>2. Add it to Cloudflare Pages → Custom Domains</p>
                  <p>3. Update domain here → Save</p>
                  <p>4. Done — no code changes needed ✅</p>
                </div>
              </div>

              <Field label="Site Name" value={settings.siteName}
                onChange={v => setSettings(s => ({ ...s, siteName: v }))} placeholder="Writeify" />
              <Field label="Support Email" value={settings.supportEmail || ''}
                onChange={v => setSettings(s => ({ ...s, supportEmail: v }))}
                placeholder="support@writeify.online"
                hint="Shown on Contact page and footer" />
              <Field label="Site Description" value={settings.siteDescription}
                onChange={v => setSettings(s => ({ ...s, siteDescription: v }))}
                type="textarea" placeholder="Convert text to beautiful handwriting…" />
              <Field label="Keywords (comma separated)" value={settings.siteKeywords}
                onChange={v => setSettings(s => ({ ...s, siteKeywords: v }))}
                type="textarea" placeholder="text to handwriting, handwriting generator…" />
              <Field label="Author" value={settings.siteAuthor}
                onChange={v => setSettings(s => ({ ...s, siteAuthor: v }))} placeholder="Mujeeb Wani" />
              <Field label="OG Title (social share)" value={settings.ogTitle}
                onChange={v => setSettings(s => ({ ...s, ogTitle: v }))}
                placeholder="Writeify - Text to Handwriting" />
              <Field label="OG Description (social share)" value={settings.ogDescription}
                onChange={v => setSettings(s => ({ ...s, ogDescription: v }))}
                type="textarea" placeholder="Convert text to beautiful multi-color handwriting…" />
              <Field label="Google Analytics ID" value={settings.analyticsId}
                onChange={v => setSettings(s => ({ ...s, analyticsId: v }))}
                placeholder="G-XXXXXXXXXX" hint="Leave blank if not using GA" />

              <Btn color="green" onClick={() => save({
                siteName: settings.siteName,
                siteDomain: settings.siteDomain,
                supportEmail: settings.supportEmail,
                siteDescription: settings.siteDescription,
                siteKeywords: settings.siteKeywords,
                siteAuthor: settings.siteAuthor,
                ogTitle: settings.ogTitle,
                ogDescription: settings.ogDescription,
                analyticsId: settings.analyticsId,
              }, '✅ Site info saved — live for all visitors!')}>
                Save Site Info → Live for Everyone
              </Btn>

              <div className="p-4 bg-slate-900 rounded-xl">
                <p className="text-xs text-slate-300 font-bold mb-2">📋 Copy to index.html (one-time for SEO bots):</p>
                <pre className="text-xs text-green-400 overflow-x-auto whitespace-pre-wrap">{`<title>${settings.siteName}</title>
<meta name="description" content="${settings.siteDescription}" />
<meta name="keywords" content="${settings.siteKeywords}" />
<meta name="author" content="${settings.siteAuthor}" />
<meta property="og:title" content="${settings.ogTitle}" />
<meta property="og:description" content="${settings.ogDescription}" />`}</pre>
              </div>
            </div>
          )}

          {/* ══ FONTS TAB ══ */}
          {activeTab === 'fonts' && (
            <div className="space-y-5">
              <h2 className="font-bold text-slate-800 text-lg">✍️ Font Management</h2>

              <div>
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">Built-in Fonts</p>
                <div className="space-y-2">
                  {['Caveat','Dancing Script','Homemade Apple','Sacramento','Shadows Into Light','Indie Flower','Kalam'].map(f => (
                    <div key={f} className="flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <span style={{ fontFamily: f }} className="text-base">{f} — Aa Bb</span>
                      <span className="text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">Built-in</span>
                    </div>
                  ))}
                </div>
              </div>

              {(settings.customFonts || []).length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">Custom Fonts</p>
                  <div className="space-y-2">
                    {(settings.customFonts || []).map((f, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-indigo-50 rounded-xl border border-indigo-100">
                        <div className="flex items-center gap-2 min-w-0">
                          <span style={{ fontFamily: `'${f.family}', cursive` }} className="text-lg text-slate-800 shrink-0">Aa</span>
                          <div className="min-w-0">
                            <span className="text-sm font-semibold">{f.label}</span>
                            <span className="text-xs text-slate-400 ml-1">({f.family})</span>
                            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-semibold ${f.src ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                              {f.src ? `Uploaded · ${(f.format || 'ttf').toUpperCase()}` : 'Google Font'}
                            </span>
                          </div>
                        </div>
                        <button onClick={async () => {
                          const updated = (settings.customFonts || []).filter((_, idx) => idx !== i);
                          await save({ customFonts: updated }, 'Font removed — live for all visitors!');
                        }} className="text-red-400 hover:text-red-600 text-xs font-bold px-2 py-1 hover:bg-red-50 rounded-lg shrink-0 ml-2">Remove</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Add Google Font ── */}
              <div className="border border-dashed border-slate-300 rounded-xl p-4 space-y-3">
                <p className="text-sm font-bold text-slate-700">+ Add Google Font</p>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Font Family Name</label>
                  <input value={newFontFamily} onChange={e => setNewFontFamily(e.target.value)}
                    placeholder="Pacifico (exact name from fonts.google.com)"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Display Label</label>
                  <input value={newFontLabel} onChange={e => setNewFontLabel(e.target.value)}
                    placeholder="Pacifico"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <Btn color="indigo" onClick={async () => {
                  if (!newFontFamily.trim()) return;
                  const link = document.createElement('link');
                  link.rel = 'stylesheet';
                  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(newFontFamily)}&display=swap`;
                  document.head.appendChild(link);
                  const updated = [...(settings.customFonts || []), { family: newFontFamily.trim(), label: newFontLabel || newFontFamily.trim() }];
                  await save({ customFonts: updated }, `Font "${newFontLabel || newFontFamily}" added — live for all visitors!`);
                  setNewFontFamily(''); setNewFontLabel('');
                }}>
                  Add Google Font → Live for Everyone
                </Btn>
              </div>

              {/* ── Upload Custom Font File (TTF / OTF / WOFF / WOFF2) ── */}
              <UploadFontSection settings={settings} save={save} />

              <p className="text-xs text-amber-600 bg-amber-50 rounded-xl p-3">
                💡 <strong>Google Fonts:</strong> enter the exact family name from fonts.google.com. &nbsp;
                <strong>Custom Fonts:</strong> upload a TTF/OTF/WOFF/WOFF2 file — it is stored in Supabase and loads for every visitor automatically.
              </p>
            </div>
          )}

          {/* ══ COLORS TAB ══ */}
          {activeTab === 'colors' && (
            <div className="space-y-5">
              <h2 className="font-bold text-slate-800 text-lg">🎨 Color Management</h2>

              <div>
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">Built-in Colors</p>
                <div className="grid grid-cols-4 gap-2">
                  {[{hex:'#1a1a1a',label:'Black'},{hex:'#1e40af',label:'Blue'},{hex:'#c0392b',label:'Red'},{hex:'#15803d',label:'Green'},{hex:'#7e22ce',label:'Purple'},{hex:'#c2410c',label:'Orange'},{hex:'#be185d',label:'Pink'},{hex:'#92400e',label:'Brown'}].map(c => (
                    <div key={c.hex} className="flex flex-col items-center gap-1 p-2 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="h-8 w-8 rounded-full border-2 border-white shadow" style={{ background: c.hex }} />
                      <span className="text-xs text-slate-500">{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {(settings.customColors || []).length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">Custom Colors</p>
                  <div className="grid grid-cols-4 gap-2">
                    {(settings.customColors || []).map((c, i) => (
                      <div key={i} className="flex flex-col items-center gap-1 p-2 bg-indigo-50 rounded-xl border border-indigo-100 relative group">
                        <div className="h-8 w-8 rounded-full border-2 border-white shadow" style={{ background: c.hex }} />
                        <span className="text-xs text-slate-500 text-center">{c.label}</span>
                        <button onClick={async () => {
                          const updated = (settings.customColors || []).filter((_, idx) => idx !== i);
                          await save({ customColors: updated }, 'Color removed — live for all visitors!');
                        }} className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border border-dashed border-slate-300 rounded-xl p-4 space-y-3">
                <p className="text-sm font-bold text-slate-700">+ Add Custom Color</p>
                <div className="flex items-center gap-3">
                  <input type="color" value={newColorHex} onChange={e => setNewColorHex(e.target.value)}
                    className="h-12 w-16 rounded-xl border border-slate-200 cursor-pointer" />
                  <div className="flex-1">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Label</label>
                    <input value={newColorLabel} onChange={e => setNewColorLabel(e.target.value)}
                      placeholder="e.g. Navy Blue"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                </div>
                <Btn color="indigo" onClick={async () => {
                  if (!newColorLabel.trim()) return;
                  const updated = [...(settings.customColors || []), { hex: newColorHex, label: newColorLabel.trim() }];
                  await save({ customColors: updated }, `Color "${newColorLabel}" added — live for all visitors!`);
                  setNewColorHex('#000000'); setNewColorLabel('');
                }}>
                  Add Color → Live for Everyone
                </Btn>
              </div>
            </div>
          )}

          {/* ══ SECURITY TAB ══ */}
          {activeTab === 'security' && (
            <div className="space-y-5">
              <h2 className="font-bold text-slate-800 text-lg">🔒 Security</h2>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
                <p>Admin URL: <code className="font-bold">writeify.online/saaki</code></p>
                <p>Password is stored only in <strong>this browser</strong> — never synced to Supabase.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">New Password</label>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1">Confirm Password</label>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Repeat password"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <Btn color="red" onClick={() => {
                if (!newPw || newPw.length < 8) { flash('Min 8 characters', false); return; }
                if (newPw !== confirmPw) { flash('Passwords do not match', false); return; }
                saveAdminPw(newPw);
                setNewPw(''); setConfirmPw('');
                flash('Password changed! Stored in this browser only.');
              }}>
                Change Password
              </Btn>

              <div className="border-t border-slate-200 pt-4">
                <p className="text-xs font-bold text-slate-700 mb-3">⚠️ Danger Zone</p>
                <button onClick={async () => {
                  if (!confirm('Reset ALL site settings to default? Supabase data will be overwritten.')) return;
                  const creds = getSupaCreds();
                  if (!creds) { flash('Connect Supabase first', false); return; }
                  const { password: _pw, supabaseUrl: _u, supabaseAnonKey: _k, ...defaults } = DEFAULT_ADMIN;
                  await save(defaults, 'All settings reset to default for all visitors!');
                }} className="w-full py-2.5 bg-slate-100 hover:bg-red-100 hover:text-red-700 text-slate-600 font-bold rounded-xl border border-slate-300 hover:border-red-300 transition-all text-sm">
                  Reset All Settings to Default
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </PageLayout>
  );
}


// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        <Route path="/" element={<ConverterPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/saaki" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  );
}
