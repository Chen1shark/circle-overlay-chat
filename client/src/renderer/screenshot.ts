import { overlayApi } from './overlayApi';
import './screenshot.css';

type Point = {
  x: number;
  y: number;
};

const MIN_SELECTION_SIZE = 8;

const root = document.getElementById('screenshot-root');
if (!root) {
  throw new Error('screenshot root not found');
}
const screenshotRoot = root;

screenshotRoot.innerHTML = `
  <div class="screenshot-surface">
    <img class="screenshot-image" alt="屏幕截图" />
    <div class="screenshot-selection" hidden></div>
    <div class="screenshot-actions" hidden>
      <button type="button" class="confirm-button">确认</button>
      <button type="button" class="cancel-button">取消</button>
    </div>
  </div>
`;

const surface = queryRequired<HTMLElement>('.screenshot-surface');
const image = queryRequired<HTMLImageElement>('.screenshot-image');
const selectionBox = queryRequired<HTMLElement>('.screenshot-selection');
const actions = queryRequired<HTMLElement>('.screenshot-actions');
const confirmButton = queryRequired<HTMLButtonElement>('.confirm-button');
const cancelButton = queryRequired<HTMLButtonElement>('.cancel-button');

let startPoint: Point | null = null;
let currentSelection: ScreenshotSelection | null = null;
let activePointerId: number | null = null;
let completing = false;

overlayApi.onScreenshotInit((payload) => {
  completing = false;
  resetSelection();
  image.onload = () => {
    void overlayApi.showScreenshot();
  };
  image.onerror = () => {
    void overlayApi.showScreenshot();
  };
  image.src = payload.dataUrl;
  surface.style.width = `${payload.viewportWidth}px`;
  surface.style.height = `${payload.viewportHeight}px`;
});
void overlayApi.readyScreenshot();

surface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.screenshot-actions')) {
    return;
  }
  event.preventDefault();
  activePointerId = event.pointerId;
  startPoint = clampPoint({ x: event.clientX, y: event.clientY });
  currentSelection = { x: startPoint.x, y: startPoint.y, width: 0, height: 0 };
  surface.setPointerCapture(event.pointerId);
  actions.hidden = true;
  renderSelection();
});

surface.addEventListener('pointermove', (event) => {
  if (activePointerId !== event.pointerId || !startPoint) {
    return;
  }
  event.preventDefault();
  currentSelection = normalizeSelection(startPoint, clampPoint({ x: event.clientX, y: event.clientY }));
  renderSelection();
});

surface.addEventListener('pointerup', (event) => {
  if (activePointerId !== event.pointerId) {
    return;
  }
  event.preventDefault();
  completeDrag(event.pointerId);
});

surface.addEventListener('pointercancel', (event) => {
  if (activePointerId === event.pointerId) {
    resetSelection();
  }
});

confirmButton.addEventListener('click', () => {
  const selection = roundedSelection();
  if (!selection) {
    resetSelection();
    return;
  }
  finish(selection);
});

cancelButton.addEventListener('click', () => finish(null));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    finish(null);
  }
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  finish(null);
});

function completeDrag(pointerId: number) {
  if (surface.hasPointerCapture(pointerId)) {
    surface.releasePointerCapture(pointerId);
  }
  activePointerId = null;
  startPoint = null;

  if (!isValidSelection(currentSelection)) {
    resetSelection();
    return;
  }
  renderSelection();
  positionActions();
}

function renderSelection() {
  if (!currentSelection) {
    selectionBox.hidden = true;
    return;
  }
  selectionBox.hidden = false;
  selectionBox.style.left = `${currentSelection.x}px`;
  selectionBox.style.top = `${currentSelection.y}px`;
  selectionBox.style.width = `${currentSelection.width}px`;
  selectionBox.style.height = `${currentSelection.height}px`;
}

function positionActions() {
  if (!currentSelection) {
    actions.hidden = true;
    return;
  }
  actions.hidden = false;
  const surfaceBounds = surface.getBoundingClientRect();
  const actionWidth = actions.offsetWidth || 112;
  const actionHeight = actions.offsetHeight || 34;
  const preferredX = currentSelection.x + currentSelection.width - actionWidth;
  const preferredY = currentSelection.y + currentSelection.height + 8;
  const fallbackY = currentSelection.y - actionHeight - 8;
  const nextX = clampNumber(preferredX, 8, surfaceBounds.width - actionWidth - 8);
  const nextY = preferredY + actionHeight + 8 <= surfaceBounds.height
    ? preferredY
    : clampNumber(fallbackY, 8, surfaceBounds.height - actionHeight - 8);

  actions.style.left = `${nextX}px`;
  actions.style.top = `${nextY}px`;
}

function resetSelection() {
  if (activePointerId !== null && surface.hasPointerCapture(activePointerId)) {
    surface.releasePointerCapture(activePointerId);
  }
  activePointerId = null;
  startPoint = null;
  currentSelection = null;
  selectionBox.hidden = true;
  actions.hidden = true;
}

function finish(selection: ScreenshotSelection | null) {
  if (completing) {
    return;
  }
  completing = true;
  void overlayApi.completeScreenshot(selection);
}

function roundedSelection() {
  if (!isValidSelection(currentSelection)) {
    return null;
  }
  return {
    x: Math.round(currentSelection.x),
    y: Math.round(currentSelection.y),
    width: Math.round(currentSelection.width),
    height: Math.round(currentSelection.height)
  };
}

function normalizeSelection(start: Point, end: Point): ScreenshotSelection {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    x: left,
    y: top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function clampPoint(point: Point): Point {
  const bounds = surface.getBoundingClientRect();
  return {
    x: clampNumber(point.x - bounds.left, 0, bounds.width),
    y: clampNumber(point.y - bounds.top, 0, bounds.height)
  };
}

function isValidSelection(selection: ScreenshotSelection | null): selection is ScreenshotSelection {
  return Boolean(selection && selection.width >= MIN_SELECTION_SIZE && selection.height >= MIN_SELECTION_SIZE);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function queryRequired<T extends Element>(selector: string) {
  const element = screenshotRoot.querySelector<T>(selector);
  if (!element) {
    throw new Error(`screenshot page missing element: ${selector}`);
  }
  return element;
}
