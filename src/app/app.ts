import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { QitsNavSubmenu } from '@qits/ui-components';
import { ProjectsNav } from './nav/projects-nav';

/**
 * The shell: an outlet, and the project picker offered to the chrome as a sub-menu.
 *
 * The chrome this app is seen through — the sidebar, the top bar, the links out to the platform's
 * other SPAs — is `QitsMainLayout` behind the `''` route (see app.routes.ts), so it survives
 * navigation rather than being rebuilt here.
 *
 * <p><b>The sub-menu is declared here and rendered somewhere else, and that is the only arrangement
 * available.</b> `QitsMainLayout` is a route component — the pages are inside *its* outlet and this
 * shell is outside it — so nothing can be projected upwards into the sidebar. The template is
 * handed over instead, and the layout renders it under this application's navigation entry.
 *
 * <p>The shell rather than a page, and that part is a correctness one: `RouterOutlet` destroys the
 * outgoing component after creating the incoming one, so a declaration inside a page would be torn
 * down and rebuilt on every hop — and the picker would flicker on a menu that did not itself change.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, QitsNavSubmenu, ProjectsNav],
  template: `
    <ng-template qitsNavSubmenu><app-projects-nav /></ng-template>
    <router-outlet />
  `,
})
export class App {}
