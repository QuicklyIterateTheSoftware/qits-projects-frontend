import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A URL under `/projects/` that this app does not recognise.
 *
 * It renders a small page and stops there. It deliberately does **not** copy spa-home's exit
 * behaviour of handing the URL back to the gateway: that is the landing page's job, and it is
 * correct only because spa-home is mounted at the root, where an unknown first segment is another
 * micro frontend rather than a typo. Here the segment is already ours — the gateway routed
 * `/projects/…` to qits-projects on purpose — so there is nobody to hand it to, and bouncing it
 * back would be a loop.
 *
 * A URL whose first segment *looks* like a project id never reaches here: it matches
 * `:projectId`, and the project page is what says the project does not exist. This is for the
 * shapes below that — a third segment nothing serves.
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
