import type { IControl, Map } from 'mapbox-gl';

type RecenterHandler = () => void;

export class RecenterControl implements IControl {
  #container: HTMLElement | null = null;
  constructor(private readonly onRecenter: RecenterHandler) {}

  onAdd(map: Map): HTMLElement {
    void map;

    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group rodalies-ctrl-group';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mapboxgl-ctrl-icon rodalies-ctrl-recenter';
    button.setAttribute('aria-label', 'Recenter map');
    button.setAttribute('data-testid', 'recenter-map');
    button.innerHTML = '<span aria-hidden="true">⌖</span>';
    button.addEventListener('click', this.handleClick);
    button.addEventListener('keydown', this.handleKeyDown);

    container.appendChild(button);
    this.#container = container;
    return container;
  }

  onRemove(): void {
    if (!this.#container) {
      return;
    }

    const button = this.#container.querySelector('button');
    if (button) {
      button.removeEventListener('click', this.handleClick);
      button.removeEventListener('keydown', this.handleKeyDown);
    }

    this.#container.remove();
    this.#container = null;
  }

  private handleClick = () => {
    this.onRecenter();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onRecenter();
    }
  };
}
