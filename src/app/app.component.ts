import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Standalone dev shell for the User remote. Only used when this remote is
 * run on its own (`ng serve user`); in production the hugmesh.systems
 * host federates `./routes` (USER_ROUTES) directly — this shell is not loaded.
 * It supplies the skip link + a <main id="main"> landmark so the remote is
 * keyboard-accessible when served standalone.
 */
@Component({
  selector: 'hug-user-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
