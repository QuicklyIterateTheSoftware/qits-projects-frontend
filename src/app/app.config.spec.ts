import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { QITS_SIGN_IN, QitsBearerFetch, QitsTokens } from '@qits/angular';
import { firstValueFrom } from 'rxjs';
import { appConfig } from './app.config';

/**
 * The bearer sign-in is wired (epic qits-543, qits-1348): the `qits-spa` client, the
 * `auth/callback` route ahead of everything else, and the interceptor on `HttpClient`. The tokens
 * themselves are the library's; a stand-in answers one so the header can be read.
 */
describe('appConfig', () => {
  const tokens = {
    accessToken: vi.fn(async () => 'token-1'),
    retryToken: vi.fn(async () => null),
    login: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: QitsTokens, useValue: tokens },
      ],
    });
  });

  it('signs in with the qits-spa client', () => {
    expect(TestBed.inject(QITS_SIGN_IN).clientId).toBe('qits-spa');
    expect(TestBed.inject(QitsBearerFetch)).toBeTruthy();
  });

  it('puts the auth/callback route before every route of its own', () => {
    expect(TestBed.inject(Router).config[0].path).toBe('auth/callback');
  });

  it('sends the bearer on an API call to this origin, and no cookie', async () => {
    const http = TestBed.inject(HttpTestingController);
    const answer = firstValueFrom(TestBed.inject(HttpClient).get('/projects/api/projects'));
    await Promise.resolve();
    await Promise.resolve();

    const request = http.expectOne('/projects/api/projects');
    expect(request.request.headers.get('authorization')).toBe('Bearer token-1');
    expect(request.request.withCredentials).toBe(false);
    request.flush([]);
    await answer;
  });
});
