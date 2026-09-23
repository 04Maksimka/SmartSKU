import { LitElement, css, svg } from "lit";

/**
 * Replica of the slot's 4-digit TM1637 seven-segment display. Glyphs use the same segment bytes as the firmware
 * (firmware/smartsku_box/CountDisplay.h): bit 0 is segment a (top), then b, c, d, e, f and bit 6 is g (middle).
 * Unlit segments stay faintly visible, like on the real module.
 */
export class SegmentDisplay extends LitElement {
  static override properties = { text: {} };

  private static readonly GLYPHS: Record<string, number> = {
    "0": 0x3f,
    "1": 0x06,
    "2": 0x5b,
    "3": 0x4f,
    "4": 0x66,
    "5": 0x6d,
    "6": 0x7d,
    "7": 0x07,
    "8": 0x7f,
    "9": 0x6f,
    "-": 0x40,
    " ": 0x00,
    O: 0x3f,
    U: 0x3e,
    t: 0x78,
    I: 0x06,
    n: 0x54,
    H: 0x76,
    L: 0x38,
    d: 0x5e,
    o: 0x5c,
    E: 0x79,
    r: 0x50,
    F: 0x71,
  };

  static readonly DIGITS = 4;
  /** Larger counts show " OFL", as on the box. */
  static readonly MAX_NUMBER = 9999;
  // One digit cell and the segment geometry, in SVG units
  private static readonly WIDTH = 56;
  private static readonly HEIGHT = 100;
  private static readonly PITCH = 70;
  private static readonly THICKNESS = 11;
  private static readonly GAP = 2;

  static override styles = css`
    :host {
      display: block;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .on {
      fill: var(--led, #ff3b30);
      filter: drop-shadow(0 0 3px rgba(255, 59, 48, 0.55));
    }

    .off {
      fill: var(--led, #ff3b30);
      opacity: 0.07;
    }
  `;

  /** Exactly four characters, like the firmware writes them (numbers are right-aligned). */
  declare text: string;

  constructor() {
    super();
    this.text = "----";
  }

  protected override render() {
    const { DIGITS, PITCH, WIDTH, HEIGHT } = SegmentDisplay;
    const chars = this.text.padStart(DIGITS).slice(-DIGITS).split("");
    const width = PITCH * (DIGITS - 1) + WIDTH;
    return svg`<svg viewBox="-6 -2 ${width + 12} ${HEIGHT + 4}" role="img" aria-label=${this.text.trim() || "пусто"}>
      <g transform="skewX(-6) translate(${HEIGHT * 0.105} 0)">
        ${chars.map((char, index) => this.digit(SegmentDisplay.GLYPHS[char] ?? 0, index * PITCH))}
      </g>
    </svg>`;
  }

  private digit(bits: number, x: number) {
    return svg`<g transform="translate(${x} 0)">
      ${this.segments().map(
        (points, segment) => svg`<polygon class=${bits & (1 << segment) ? "on" : "off"} points=${points}></polygon>`,
      )}
    </g>`;
  }

  /** Hexagonal segments a–g of one digit. */
  private segments(): string[] {
    const { WIDTH: w, HEIGHT: h, THICKNESS: t, GAP: g } = SegmentDisplay;
    const half = t / 2;
    const horizontal = (y: number) =>
      [
        [half + g, y],
        [t + g, y - half],
        [w - t - g, y - half],
        [w - half - g, y],
        [w - t - g, y + half],
        [t + g, y + half],
      ]
        .map((point) => point.join(","))
        .join(" ");
    const vertical = (x: number, top: number, bottom: number) =>
      [
        [x, top + g],
        [x + half, top + half + g],
        [x + half, bottom - half - g],
        [x, bottom - g],
        [x - half, bottom - half - g],
        [x - half, top + half + g],
      ]
        .map((point) => point.join(","))
        .join(" ");
    const middle = h / 2;
    return [
      horizontal(half), // a
      vertical(w - half, half, middle), // b
      vertical(w - half, middle, h - half), // c
      horizontal(h - half), // d
      vertical(half, middle, h - half), // e
      vertical(half, half, middle), // f
      horizontal(middle), // g
    ];
  }
}
