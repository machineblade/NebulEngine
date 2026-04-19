// ============================================================
//  src/utils/MathUtils.js — Common Math Helpers
// ============================================================

export class MathUtils {
  static clamp (v, min, max) { return Math.max(min, Math.min(max, v)); }
  static lerp  (a, b, t)     { return a + (b - a) * t; }
  static randInt   (lo, hi)  { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
  static randRange (lo, hi)  { return lo + Math.random() * (hi - lo); }
  static deg2rad (d) { return d * Math.PI / 180; }
  static rad2deg (r) { return r * 180 / Math.PI; }
  static dist (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
  static normalize (x, y) {
    const len = Math.hypot(x, y);
    return len === 0 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
  }
  static mapRange (v, inLo, inHi, outLo, outHi) {
    return outLo + ((v - inLo) / (inHi - inLo)) * (outHi - outLo);
  }
}