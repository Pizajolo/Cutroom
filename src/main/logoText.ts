// Text turned into outlines with a real font file, for wordmarks: the logo then looks the same everywhere, with no
// font installed and in every tool that opens the SVG.
import { openSync } from 'fontkit';
import type { Font, FontCollection, Glyph } from 'fontkit';

export interface Outline {
  /** One SVG path for the whole line, its top-left at 0,0. */
  d: string;
  width: number;
  /** From the top of the tallest letter the font allows to the bottom of the lowest. */
  height: number;
  /** Distance from the top to the baseline. */
  baseline: number;
  /** Height of capital letters, for lining text up with shapes. */
  capHeight: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** `text` set in `file` at `size` px, with `tracking` in em (0.1 = a tenth of the size between letters). */
export function textOutline(file: string, text: string, size: number, tracking = 0): Outline {
  const opened = openSync(file) as Font | FontCollection;
  const font = ('fonts' in opened ? opened.fonts[0] : opened) as Font;
  const scale = size / font.unitsPerEm;
  const ascent = font.ascent * scale;
  const run = font.layout(text);
  let x = 0;
  const parts: string[] = [];
  run.glyphs.forEach((glyph: Glyph, i: number) => {
    const pos = run.positions[i]!;
    // Font units point up; SVG points down.
    const shape = glyph.path.scale(scale, -scale).translate(x + pos.xOffset * scale, ascent - pos.yOffset * scale).toSVG();
    if (shape) parts.push(shape);
    x += pos.xAdvance * scale + (i < run.glyphs.length - 1 ? tracking * size : 0);
  });
  const d = parts.join(' ').replace(/-?\d+\.\d{3,}/g, (n) => String(round(Number(n))));
  return { d, width: round(x), height: round(ascent - font.descent * scale), baseline: round(ascent), capHeight: round((font.capHeight || font.ascent * 0.7) * scale) };
}
