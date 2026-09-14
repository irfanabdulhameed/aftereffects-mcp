/*
 * PNG helpers for the render tools: decode, box-filter downscale, tile into a
 * contact sheet, encode. Everything runs in Node with pngjs; After Effects
 * only ever writes full-size frames to disk.
 */

import { PNG } from 'pngjs';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Buffer;
}

export function decodePng(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png);
}

export function blankImage(width: number, height: number, rgba: [number, number, number, number] = [0, 0, 0, 255]): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width, height, data };
}

/**
 * Target size for a frame given a scale (0..1) and an optional width cap.
 * Both limits apply; the smaller result wins. Never smaller than 1 x 1.
 */
export function targetSize(width: number, height: number, scale: number | undefined, maxWidth: number | undefined): { width: number; height: number } {
  let factor = scale !== undefined && scale > 0 && scale < 1 ? scale : 1;
  if (maxWidth !== undefined && maxWidth > 0 && width * factor > maxWidth) factor = maxWidth / width;
  if (factor >= 1) return { width, height };
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

/** Box-filter resize (area average). Upscaling is not done; sizes at or above the source are returned unchanged. */
export function resizeImage(src: RgbaImage, dstWidth: number, dstHeight: number): RgbaImage {
  if (dstWidth >= src.width && dstHeight >= src.height) return src;
  const dw = Math.max(1, Math.min(dstWidth, src.width));
  const dh = Math.max(1, Math.min(dstHeight, src.height));
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor((y * src.height) / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * src.height) / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor((x * src.width) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * src.width) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        let idx = (sy * src.width + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx++) {
          r += src.data[idx];
          g += src.data[idx + 1];
          b += src.data[idx + 2];
          a += src.data[idx + 3];
          idx += 4;
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: dw, height: dh, data: out };
}

/** Convenience: decode, scale to the target size, encode. Returns the new size too. */
export function scalePngBuffer(buffer: Buffer, scale: number | undefined, maxWidth: number | undefined): { png: Buffer; width: number; height: number; sourceWidth: number; sourceHeight: number } {
  const src = decodePng(buffer);
  const size = targetSize(src.width, src.height, scale, maxWidth);
  const resized = resizeImage(src, size.width, size.height);
  return { png: encodePng(resized), width: resized.width, height: resized.height, sourceWidth: src.width, sourceHeight: src.height };
}

export interface TileLayout {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  width: number;
  height: number;
  positions: Array<{ index: number; x: number; y: number; w: number; h: number }>;
}

/** Grid layout for `count` tiles of one size with a gap between them and no outer margin. */
export function tileLayout(count: number, columns: number, tileWidth: number, tileHeight: number, gap = 2): TileLayout {
  const cols = Math.max(1, Math.min(columns, Math.max(1, count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const positions: TileLayout['positions'] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    positions.push({ index: i, x: c * (tileWidth + gap), y: r * (tileHeight + gap), w: tileWidth, h: tileHeight });
  }
  return {
    columns: cols,
    rows,
    tileWidth,
    tileHeight,
    gap,
    width: cols * tileWidth + (cols - 1) * gap,
    height: rows * tileHeight + (rows - 1) * gap,
    positions,
  };
}

function blit(dst: RgbaImage, src: RgbaImage, x0: number, y0: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.height) continue;
    const w = Math.min(src.width, dst.width - x0);
    if (w <= 0) continue;
    src.data.copy(dst.data, (dy * dst.width + x0) * 4, (y * src.width) * 4, (y * src.width + w) * 4);
  }
}

function drawBorder(img: RgbaImage, x0: number, y0: number, w: number, h: number, rgba: [number, number, number, number]): void {
  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const o = (y * img.width + x) * 4;
    img.data[o] = rgba[0];
    img.data[o + 1] = rgba[1];
    img.data[o + 2] = rgba[2];
    img.data[o + 3] = rgba[3];
  };
  for (let x = x0; x < x0 + w; x++) {
    put(x, y0);
    put(x, y0 + h - 1);
  }
  for (let y = y0; y < y0 + h; y++) {
    put(x0, y);
    put(x0 + w - 1, y);
  }
}

export interface TiledSheet {
  png: Buffer;
  layout: TileLayout;
}

/**
 * Tiles already-decoded images into one sheet. Every tile is scaled to the
 * size of the first image after `scale` and the sheet-wide `maxWidth` cap.
 * When `border` is true a one pixel white line marks each tile's edge.
 */
export function tileImages(images: RgbaImage[], opts: { columns: number; scale?: number; maxWidth?: number; gap?: number; border?: boolean }): TiledSheet {
  if (images.length === 0) throw new Error('tileImages needs at least one image');
  const gap = opts.gap ?? 2;
  const columns = Math.max(1, Math.min(opts.columns, images.length));
  const first = images[0];
  let tile = targetSize(first.width, first.height, opts.scale, undefined);
  if (opts.maxWidth !== undefined && opts.maxWidth > 0) {
    const sheetWidth = columns * tile.width + (columns - 1) * gap;
    if (sheetWidth > opts.maxWidth) {
      const perTile = Math.max(1, Math.floor((opts.maxWidth - (columns - 1) * gap) / columns));
      tile = targetSize(tile.width, tile.height, undefined, perTile);
    }
  }
  const layout = tileLayout(images.length, columns, tile.width, tile.height, gap);
  const sheet = blankImage(layout.width, layout.height, [32, 32, 32, 255]);
  for (const pos of layout.positions) {
    const img = images[pos.index];
    const scaled = resizeImage(img, tile.width, tile.height);
    blit(sheet, scaled, pos.x, pos.y);
    if (opts.border !== false) drawBorder(sheet, pos.x, pos.y, tile.width, tile.height, [255, 255, 255, 255]);
  }
  return { png: encodePng(sheet), layout };
}
