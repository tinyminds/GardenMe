export interface Analytics {
  track(event: string, props?: Record<string, unknown>): void;
}

export class NoopAnalytics implements Analytics {
  track(_event: string, _props?: Record<string, unknown>) {
    // No-op by design for MVP
  }
}
