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
      border-radius: 12px;
    }

    .muted {
      color: var(--muted);
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.92em;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
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
      border-radius: 6px;
      font-size: 12px;
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
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    td {
      padding: 9px 12px;
      border-bottom: 1px solid var(--border);
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
      font: inherit;
      font-size: 14px;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      min-width: 0;
    }

    button {
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      cursor: pointer;
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
      color: #fff;
    }

    button.primary:hover:not(:disabled) {
      filter: brightness(1.08);
      color: #fff;
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
