import { css } from "lit";

/** Styles shared by all shadow roots; color tokens live in index.html and inherit into them. */
export class Theme {
  static readonly shared = css`
    :host {
      display: block;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }

    * {
      box-sizing: border-box;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r, 14px);
      box-shadow: 0 1px 2px rgba(20, 23, 28, 0.04);
    }

    .muted {
      color: var(--muted);
    }

    .mono {
      font-family: var(--mono);
      font-size: 0.92em;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 9px;
      border-radius: 999px;
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      white-space: nowrap;
      text-transform: uppercase;
      background: var(--tone-neutral-bg);
      color: var(--tone-neutral);
    }

    .pill.good {
      background: var(--tone-good-bg);
      color: var(--tone-good);
    }

    .pill.bad {
      background: var(--tone-bad-bg);
      color: var(--tone-bad);
    }

    .pill.warn {
      background: var(--tone-warn-bg);
      color: var(--tone-warn);
    }

    .pill.info {
      background: var(--tone-info-bg);
      color: var(--tone-info);
    }

    .tag {
      display: inline-block;
      padding: 1px 8px;
      border-radius: var(--r-xs, 6px);
      font-family: var(--mono);
      font-size: 11.5px;
      letter-spacing: 0.02em;
      background: var(--chip);
      color: var(--muted);
    }

    .section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin: 0 0 12px;
    }

    .section-title h2 {
      margin: 0;
      font-size: 18px;
      letter-spacing: -0.01em;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th {
      text-align: left;
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    td {
      padding: 9px 12px;
      border-bottom: 1px solid var(--border-2, var(--border));
      vertical-align: middle;
    }

    tr:last-child td {
      border-bottom: none;
    }

    .num,
    .nowrap {
      text-align: right;
      white-space: nowrap;
    }

    .nowrap {
      text-align: left;
    }

    td.mono,
    td .mono {
      white-space: nowrap;
    }

    .empty {
      padding: 28px 16px;
      text-align: center;
      color: var(--muted);
    }

    input,
    select {
      font-family: var(--sans);
      font-size: 14px;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      min-width: 0;
    }

    input:focus,
    select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-soft);
    }

    button {
      font-family: var(--sans);
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px 13px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }

    button:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }

    button:disabled {
      opacity: 0.55;
      cursor: progress;
    }

    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-ink, #20242D);
    }

    button.primary:hover:not(:disabled) {
      filter: brightness(1.08);
      color: var(--accent-ink, #20242D);
    }

    button.danger:hover:not(:disabled) {
      border-color: var(--tone-bad);
      color: var(--tone-bad);
    }

    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `;
}
