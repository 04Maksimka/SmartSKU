export type ThemeChoice = "system" | "light" | "dark";

/**
 * Light or dark dashboard: follows the system unless the user picked one in the header. The choice is kept in this
 * browser (localStorage) and applied as data-theme on <html>; index.html applies it again before the first paint.
 */
export class ThemePreference {
  static readonly ORDER: ThemeChoice[] = ["system", "light", "dark"];
  private static readonly STORAGE_KEY = "skubox.theme";

  current(): ThemeChoice {
    try {
      const saved = localStorage.getItem(ThemePreference.STORAGE_KEY);
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  }

  /** The next choice for a single switch button: system → light → dark → system. */
  next(choice: ThemeChoice): ThemeChoice {
    const order = ThemePreference.ORDER;
    return order[(order.indexOf(choice) + 1) % order.length];
  }

  set(choice: ThemeChoice): void {
    try {
      if (choice === "system") {
        localStorage.removeItem(ThemePreference.STORAGE_KEY);
      } else {
        localStorage.setItem(ThemePreference.STORAGE_KEY, choice);
      }
    } catch {
      // Storage may be unavailable (private mode): the choice lasts until reload
    }
    this.apply(choice);
  }

  apply(choice: ThemeChoice): void {
    const root = document.documentElement;
    if (choice === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = choice;
    }
    // The browser bar colour follows the forced theme too
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const scheme = meta.dataset.scheme;
      meta.media = choice === "system" ? `(prefers-color-scheme: ${scheme})` : scheme === choice ? "all" : "not all";
    }
  }
}
