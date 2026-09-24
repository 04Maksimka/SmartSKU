import { css } from "lit";

/** Modal dialogs of the dashboard: frame, headings, notes and the button row. */
export class DialogStyles {
  static readonly shared = css`
    dialog {
      width: min(600px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--r, 14px);
      background: var(--surface);
      color: var(--text);
    }

    dialog::backdrop {
      background: rgba(12, 13, 16, 0.5);
    }

    .body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    h2 {
      margin: 0;
      font-size: 19px;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      color: var(--muted);
    }

    .note {
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      background: var(--tone-info-bg);
      color: var(--tone-info);
    }

    .note.warn {
      background: var(--tone-warn-bg);
      color: var(--tone-warn);
    }

    .note.good {
      background: var(--tone-good-bg);
      color: var(--tone-good);
    }

    .note.bad,
    .error {
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      background: var(--tone-bad-bg);
      color: var(--tone-bad);
    }

    .note ul {
      margin: 6px 0 0;
      padding-left: 18px;
      line-height: 1.55;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
  `;
}
