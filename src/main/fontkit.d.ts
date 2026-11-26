// The part of fontkit (which ships no types) that logoText.ts uses.
declare module 'fontkit' {
  export interface Path {
    scale(x: number, y: number): Path;
    translate(x: number, y: number): Path;
    toSVG(): string;
  }
  export interface Glyph {
    path: Path;
  }
  export interface GlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }
  export interface GlyphRun {
    glyphs: Glyph[];
    positions: GlyphPosition[];
  }
  export interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    capHeight: number;
    familyName: string;
    layout(text: string): GlyphRun;
  }
  export interface FontCollection {
    fonts: Font[];
  }
  export function openSync(file: string): Font | FontCollection;
}
