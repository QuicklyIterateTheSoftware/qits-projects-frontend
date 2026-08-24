import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The shell: an outlet, and nothing else.
 *
 * The chrome this app is seen through — the sidebar with its project node, its category groups and
 * the links out to the platform's other SPAs — is `QitsMainLayout` behind the `''` route (see
 * app.routes.ts), so it survives navigation rather than being rebuilt here.
 *
 * <p><b>It used to hand the layout a sub-menu template</b> holding this application's own two
 * links, Overview and Project setup. The chrome renders the Project node and its "Project setup"
 * child itself now — from the navigation the edge serves and the project list it already reads —
 * so the template would be a second, private copy of what every SPA on the platform draws.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {}
