/** Shared fetch plumbing: JSON in, JSON out, backend error text preserved for the user. */
export class HttpClient {
  constructor(protected readonly baseUrl: string) {}

  protected async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${path}: ${await this.failure(response)}`);
    }
    return (await response.json()) as T;
  }

  protected async send<T>(path: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await this.failure(response));
    }
    return (response.status === 204 ? null : await response.json()) as T;
  }

  /** Domain errors come back as {"detail": "..."} and are shown to the user as is. */
  private async failure(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") {
        return payload.detail;
      }
      if (Array.isArray(payload.detail)) {
        return payload.detail.map((item) => (item as { msg?: string }).msg ?? String(item)).join("; ");
      }
    } catch {
      // Non-JSON error body: the status code is all we have.
    }
    return `HTTP ${response.status}`;
  }
}
