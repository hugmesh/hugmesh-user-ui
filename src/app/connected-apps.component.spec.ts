import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ConnectedAppsComponent } from './connected-apps.component';
import { ConnectedClient, ConnectedClientsService } from './connected-clients.service';
import { SessionService } from './session.service';

describe('ConnectedAppsComponent', () => {
  let clients: jasmine.SpyObj<ConnectedClientsService>;
  const hasRole = signal(false);

  const client: ConnectedClient = {
    id: 'c1',
    owner: 'sub-1',
    platform: 'matrix',
    clientKind: 'oauth-app',
    label: 'Element',
    createdAt: '2026-01-01T00:00:00Z',
  };

  async function setup(role: boolean): Promise<ComponentFixture<ConnectedAppsComponent>> {
    hasRole.set(role);
    clients = jasmine.createSpyObj<ConnectedClientsService>('ConnectedClientsService', [
      'list', 'revoke',
    ]);
    clients.list.and.returnValue(of([client]));
    await TestBed.configureTestingModule({
      imports: [ConnectedAppsComponent],
      providers: [
        { provide: ConnectedClientsService, useValue: clients },
        { provide: SessionService, useValue: { hasExternalClientRole: hasRole } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConnectedAppsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  describe('DENY — caller WITHOUT an external-client role', () => {
    it('does NOT fetch the list (mirrors the API gate, no 403-on-click)', async () => {
      await setup(false);
      expect(clients.list).not.toHaveBeenCalled();
    });

    it('renders the surface aria-DISABLED (focusable) with helptext explaining the missing role', async () => {
      const fixture = await setup(false);
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="connected-apps-disabled"]')!;
      // NOT natively disabled — it stays focusable so a screen reader reaches it
      // and announces the aria-describedby helptext explaining the gate.
      expect(btn.disabled).toBe(false);
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      const helpId = btn.getAttribute('aria-describedby')!;
      const help = el.querySelector(`#${helpId}`)!;
      expect(help.textContent).toContain('external-client role');
      // The table must NOT render.
      expect(el.querySelector('[data-testid="connected-apps-rows"]')).toBeNull();
    });
  });

  describe('ALLOW — caller WITH an external-client role', () => {
    it('fetches and renders a row per connected client', async () => {
      const fixture = await setup(true);
      expect(clients.list).toHaveBeenCalledTimes(1);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-client-id="c1"]')).not.toBeNull();
      // The disabled gate must NOT render.
      expect(el.querySelector('[data-testid="connected-apps-disabled"]')).toBeNull();
    });

    it('gives the revoke button a descriptive aria-label and revokes through the service', async () => {
      const fixture = await setup(true);
      clients.revoke.and.returnValue(of({ revoked: true }));
      clients.list.and.returnValue(of([]));
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-revoke="c1"]')!;
      expect(btn.getAttribute('aria-label')).toContain('Element');
      await fixture.componentInstance.revoke(client);
      expect(clients.revoke).toHaveBeenCalledWith('c1');
    });

    it('shows an empty-state message when there are no clients', async () => {
      hasRole.set(true);
      clients = jasmine.createSpyObj<ConnectedClientsService>('ConnectedClientsService', ['list', 'revoke']);
      clients.list.and.returnValue(of([]));
      await TestBed.configureTestingModule({
        imports: [ConnectedAppsComponent],
        providers: [
          { provide: ConnectedClientsService, useValue: clients },
          { provide: SessionService, useValue: { hasExternalClientRole: hasRole } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(ConnectedAppsComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="connected-apps-empty"]')).not.toBeNull();
    });

    it('surfaces a friendly message when the list load fails', async () => {
      hasRole.set(true);
      clients = jasmine.createSpyObj<ConnectedClientsService>('ConnectedClientsService', ['list', 'revoke']);
      clients.list.and.returnValue(throwError(() => new Error('boom')));
      await TestBed.configureTestingModule({
        imports: [ConnectedAppsComponent],
        providers: [
          { provide: ConnectedClientsService, useValue: clients },
          { provide: SessionService, useValue: { hasExternalClientRole: hasRole } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(ConnectedAppsComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance.statusMessage()).toContain('Could not load');
    });
  });
});
