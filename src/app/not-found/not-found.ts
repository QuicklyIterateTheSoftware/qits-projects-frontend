import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A URL on this host that this app does not recognise.
 *
 * It renders a small page and stops there, and it deliberately does **not** hand the URL back to
 * the edge. This application is served at the root of `projects.<env>.<domain>` — the whole host is
 * ours — so there is nobody to hand it to, and bouncing it back would be a loop.
 *
 * A URL whose first segment *looks* like a project never reaches here: it matches `:project`, and
 * the project page is what says the project does not exist. This is for the shapes below that — a
 * third segment naming no category, a fourth segment nothing serves. The repository page renders it
 * inline for the other half of the same question: a well-formed repository address naming a
 * repository the project does not hold.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>No such page here</h1>
    <p>
      This is the projects explorer. It has a page per project, and a form for adding a repository
      to one.
    </p>
    <p><a routerLink="/">Back to the projects</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {}
