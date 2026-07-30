import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PreferencesComponent } from './preferences.component';
import { PREF_MEDIA_POISON_DEFAULT, PreferencesService } from './preferences.service';

describe('PreferencesComponent', () => {
  let fixture: ComponentFixture<PreferencesComponent>;
  let component: PreferencesComponent;
  let service: jasmine.SpyObj<PreferencesService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj<PreferencesService>('PreferencesService', ['load', 'set']);
    service.load.and.returnValue(of({ [PREF_MEDIA_POISON_DEFAULT]: 'medium' }));
    await TestBed.configureTestingModule({
      imports: [PreferencesComponent],
      providers: [{ provide: PreferencesService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(PreferencesComponent);
    component = fixture.componentInstance;
  });

  // ── USER-SITUATIONAL ─────────────────────────────────────────────────────

  it('loads preferences on init and reflects media.poison.default in the select', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.load).toHaveBeenCalledTimes(1);
    expect(component.poisonMode()).toBe('medium');

    const el: HTMLElement = fixture.nativeElement;
    const select = el.querySelector('[data-testid="prefs-poison-select"]') as HTMLSelectElement;
    expect(select).withContext('select is rendered').toBeTruthy();
    expect(select.value).toBe('medium');
  });

  it('shows the AI-cloak fieldset with all four mode options', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const options = el.querySelectorAll('[data-testid="prefs-poison-select"] option');
    expect(options.length).toBe(4);
    const values = Array.from(options).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['off', 'low', 'medium', 'high']);
  });

  it('calls service.set and shows saved message on select change', async () => {
    service.set.and.returnValue(of({ [PREF_MEDIA_POISON_DEFAULT]: 'high' }));
    fixture.detectChanges();
    await fixture.whenStable();

    const event = new Event('change');
    const select = document.createElement('select');
    // A <select> only retains an assigned value when a matching <option> exists
    // (per the HTML spec); without options select.value stays '' and the test
    // would pass '' to service.set. Add real options so 'high' is selectable.
    for (const value of ['off', 'low', 'medium', 'high']) {
      const option = document.createElement('option');
      option.value = value;
      select.appendChild(option);
    }
    select.value = 'high';
    Object.defineProperty(event, 'target', { value: select });
    await component.onPoisonChange(event);

    expect(service.set).toHaveBeenCalledWith(PREF_MEDIA_POISON_DEFAULT, 'high');
    expect(component.statusMessage()).toBe('Preference saved.');
    expect(component.poisonMode()).toBe('high');
  });

  it('shows a save error when set() fails', async () => {
    service.set.and.returnValue(throwError(() => new Error('network')));
    fixture.detectChanges();
    await fixture.whenStable();

    const event = new Event('change');
    const select = document.createElement('select');
    select.value = 'off';
    Object.defineProperty(event, 'target', { value: select });
    await component.onPoisonChange(event);

    expect(component.statusMessage()).toBe('Could not save your preference — please try again.');
  });

  // ── DENY / ERROR ─────────────────────────────────────────────────────────

  it('shows a load error and disables the select when load() fails', async () => {
    service.load.and.returnValue(throwError(() => new Error('500')));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.loadError()).toBeTruthy();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="prefs-load-error"]')).toBeTruthy();
    const select = el.querySelector('[data-testid="prefs-poison-select"]') as HTMLSelectElement;
    expect(select.disabled).toBeTrue();
  });
});
