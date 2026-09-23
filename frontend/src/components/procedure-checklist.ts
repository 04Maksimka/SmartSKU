import { LitElement, css, html, nothing } from "lit";

import type { ChecklistItem } from "../app/calibration-plan";
import { Theme } from "./theme";

/** Steps of a calibration: passed ones are ticked, the one the box waits for is highlighted. */
export class ProcedureChecklist extends LitElement {
  static override properties = { items: { attribute: false } };

  static override styles = [
    Theme.shared,
    css`
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      li {
        display: grid;
        grid-template-columns: 26px 1fr auto;
        align-items: start;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid transparent;
      }

      .marker {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        font-size: 12px;
        font-weight: 700;
        border: 2px solid var(--border);
        color: var(--muted);
        background: var(--surface);
      }

      .title {
        font-weight: 600;
        line-height: 1.35;
      }

      .hint {
        margin-top: 2px;
        font-size: 13px;
        color: var(--muted);
      }

      .display {
        padding: 2px 8px;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        letter-spacing: 0.08em;
        background: var(--chip);
        color: var(--muted);
        white-space: nowrap;
      }

      li.done .marker {
        border-color: var(--tone-good);
        background: var(--tone-good);
        color: var(--surface);
      }

      li.done .title {
        color: var(--muted);
        font-weight: 500;
      }

      li.done .hint,
      li.pending .hint {
        display: none;
      }

      li.pending {
        opacity: 0.6;
      }

      li.current {
        border-color: var(--accent);
        background: var(--accent-soft);
      }

      li.current .marker {
        border-color: var(--accent);
        background: var(--accent);
        color: var(--surface);
        animation: pulse 1.4s ease-out infinite;
      }

      li.current .display {
        background: var(--text);
        color: var(--surface);
      }

      li.failed {
        border-color: var(--tone-bad);
        background: var(--tone-bad-bg);
      }

      li.failed .marker {
        border-color: var(--tone-bad);
        background: var(--tone-bad);
        color: var(--surface);
      }

      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 var(--accent);
        }
        100% {
          box-shadow: 0 0 0 8px transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        li.current .marker {
          animation: none;
        }
      }
    `,
  ];

  declare items: ChecklistItem[];

  constructor() {
    super();
    this.items = [];
  }

  protected override render() {
    return html`
      <ol>
        ${this.items.map(
          (item, index) => html`
            <li class=${item.state} aria-current=${item.state === "current" ? "step" : "false"}>
              <span class="marker">${this.marker(item, index)}</span>
              <div>
                <div class="title">${item.title}</div>
                ${item.hint ? html`<div class="hint">${item.hint}</div>` : nothing}
              </div>
              ${item.display ? html`<span class="display" title="Надпись на дисплее слота">${item.display}</span>` : nothing}
            </li>
          `,
        )}
      </ol>
    `;
  }

  private marker(item: ChecklistItem, index: number): string {
    if (item.state === "done") {
      return "✓";
    }
    return item.state === "failed" ? "!" : String(index + 1);
  }
}
