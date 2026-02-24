import type { IControl, Map } from 'mapbox-gl';

export type ViewMode = 'free' | 'birdsEye';

type ViewModeChangeHandler = (mode: ViewMode) => void;

export interface ViewModeLabels {
  birdsEye: string;
  freeView: string;
}

// Camera/video icon for the trigger button
const CAMERA_ICON = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="5" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <path d="M14 8.5l4-2.5v8l-4-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

export class ViewModeControl implements IControl {
  private container: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private dropdown: HTMLElement | null = null;
  private isOpen = false;
  private currentMode: ViewMode = 'free';
  private readonly onViewModeChange: ViewModeChangeHandler;
  private labels: ViewModeLabels;
  private handleDocumentClick: ((e: MouseEvent) => void) | null = null;

  constructor(onViewModeChange: ViewModeChangeHandler, labels: ViewModeLabels) {
    this.onViewModeChange = onViewModeChange;
    this.labels = labels;
  }

  onAdd(map: Map): HTMLElement {
    void map;

    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group rodalies-ctrl-group rodalies-ctrl-viewmode-wrapper';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rodalies-ctrl-viewmode';
    button.setAttribute('aria-label', 'Camera view');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('data-testid', 'viewmode-toggle');
    button.innerHTML = CAMERA_ICON;
    button.addEventListener('click', this.handleButtonClick);
    button.addEventListener('keydown', this.handleButtonKeyDown);

    const dropdown = document.createElement('div');
    dropdown.className = 'rodalies-ctrl-viewmode-dropdown';
    dropdown.setAttribute('role', 'menu');

    this.buildDropdownItems(dropdown);

    this.button = button;
    this.dropdown = dropdown;
    container.appendChild(button);
    container.appendChild(dropdown);
    this.container = container;

    // Close dropdown when clicking outside
    this.handleDocumentClick = (e: MouseEvent) => {
      if (this.isOpen && !container.contains(e.target as Node)) {
        this.closeDropdown();
      }
    };
    document.addEventListener('click', this.handleDocumentClick);

    return container;
  }

  onRemove(): void {
    if (this.handleDocumentClick) {
      document.removeEventListener('click', this.handleDocumentClick);
      this.handleDocumentClick = null;
    }

    if (this.button) {
      this.button.removeEventListener('click', this.handleButtonClick);
      this.button.removeEventListener('keydown', this.handleButtonKeyDown);
      this.button = null;
    }

    this.dropdown = null;

    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  setMode(mode: ViewMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.updateActiveItem();
  }

  updateLabels(labels: ViewModeLabels): void {
    this.labels = labels;
    if (this.dropdown) {
      this.dropdown.innerHTML = '';
      this.buildDropdownItems(this.dropdown);
    }
  }

  private buildDropdownItems(dropdown: HTMLElement): void {
    const items: { mode: ViewMode; label: string }[] = [
      { mode: 'free', label: this.labels.freeView },
      { mode: 'birdsEye', label: this.labels.birdsEye },
    ];

    for (const item of items) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rodalies-ctrl-viewmode-item';
      el.setAttribute('role', 'menuitem');
      el.setAttribute('data-mode', item.mode);
      if (item.mode === this.currentMode) {
        el.classList.add('rodalies-ctrl-viewmode-item--active');
      }
      el.textContent = item.label;
      el.addEventListener('click', () => this.selectMode(item.mode));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.selectMode(item.mode);
        }
      });
      dropdown.appendChild(el);
    }
  }

  private updateActiveItem(): void {
    if (!this.dropdown) return;
    const items = this.dropdown.querySelectorAll('.rodalies-ctrl-viewmode-item');
    items.forEach((el) => {
      const mode = el.getAttribute('data-mode');
      el.classList.toggle('rodalies-ctrl-viewmode-item--active', mode === this.currentMode);
    });
  }

  private selectMode(mode: ViewMode): void {
    if (mode !== this.currentMode) {
      this.currentMode = mode;
      this.updateActiveItem();
      this.onViewModeChange(mode);
    }
    this.closeDropdown();
  }

  private toggleDropdown(): void {
    if (this.isOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  private openDropdown(): void {
    this.isOpen = true;
    this.dropdown?.classList.add('rodalies-ctrl-viewmode-dropdown--open');
    this.button?.setAttribute('aria-expanded', 'true');
  }

  private closeDropdown(): void {
    this.isOpen = false;
    this.dropdown?.classList.remove('rodalies-ctrl-viewmode-dropdown--open');
    this.button?.setAttribute('aria-expanded', 'false');
  }

  private handleButtonClick = () => {
    this.toggleDropdown();
  };

  private handleButtonKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleDropdown();
    } else if (event.key === 'Escape') {
      this.closeDropdown();
    }
  };
}
