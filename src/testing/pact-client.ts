import { provideHttpClient, withFetch } from '@angular/common/http';
import type { ProviderToken } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QITS_API_BASE } from '../app/api/api-base';

/**
 * One of this app's api classes, talking to a pact mock server at `url` through a real
 * `HttpClient` on the fetch backend — the same transport the app ships with, only its base moved
 * from the page's own origin to the mock server. Call it once per test: it configures the testing
 * module.
 */
export function apiAt<T>(url: string, api: ProviderToken<T>): T {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withFetch()), { provide: QITS_API_BASE, useValue: url }],
  });
  return TestBed.inject(api);
}
