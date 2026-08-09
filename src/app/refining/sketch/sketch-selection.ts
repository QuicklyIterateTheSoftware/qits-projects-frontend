import { Injectable, signal } from '@angular/core';

/** A cross-tab request to open one saved image on the Sketch canvas. */
@Injectable({ providedIn: 'root' })
export class SketchSelection {
  private readonly requested = signal<string | null>(null);
  readonly attachmentId = this.requested.asReadonly();

  open(attachmentId: string): void {
    this.requested.set(attachmentId);
  }

  consumed(attachmentId: string): void {
    if (this.requested() === attachmentId) this.requested.set(null);
  }
}
