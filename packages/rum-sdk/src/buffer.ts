import type { RumEventInput } from "./types.js";

const MAX_EVENTS = 20;
const MAX_WAIT_MS = 5000;

/**
 * Simple batching buffer. Flushes when it hits MAX_EVENTS, after
 * MAX_WAIT_MS since the first buffered event, or when the caller
 * manually drains it.
 */
export class Buffer {
  private events: RumEventInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushCallback?: () => void;

  onFlush(cb: () => void): void {
    this.flushCallback = cb;
  }

  push(ev: RumEventInput): void {
    this.events.push(ev);
    if (this.events.length >= MAX_EVENTS) {
      this.triggerFlush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.triggerFlush(), MAX_WAIT_MS);
    }
  }

  drain(): RumEventInput[] {
    const out = this.events;
    this.events = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return out;
  }

  private triggerFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushCallback?.();
  }
}
