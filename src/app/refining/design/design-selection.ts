import { Injectable, signal } from '@angular/core';

/** A cross-tab request to open one stored design on the Design tab. */
@Injectable({ providedIn: 'root' })
export class DesignSelection {
  private readonly requested = signal<string | null>(null);
  readonly designId = this.requested.asReadonly();

  open(designId: string): void {
    this.requested.set(designId);
  }

  consumed(designId: string): void {
    if (this.requested() === designId) this.requested.set(null);
  }
}
