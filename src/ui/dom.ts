type EventMap = HTMLElementEventMap;

export interface ElProps {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  /** Inline styles, for values that are computed rather than designed. */
  style?: Partial<CSSStyleDeclaration>;
  /** CSS custom properties, e.g. { '--rim-color': '#fff' }. */
  vars?: Record<string, string>;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: { [K in keyof EventMap]?: (event: EventMap[K]) => void };
}

export type Child = Node | string | null | undefined | false;

/**
 * Create an element.
 *
 * Text is always assigned through textContent, never innerHTML, so no path in
 * this app can turn data into markup.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.type && 'type' in node) (node as unknown as { type: string }).type = props.type;

  if (props.style) Object.assign(node.style, props.style);
  if (props.vars) {
    for (const [key, value] of Object.entries(props.vars)) node.style.setProperty(key, value);
  }
  if (props.dataset) Object.assign(node.dataset, props.dataset);
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) node.setAttribute(key, value);
  }
  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      node.addEventListener(name, handler as EventListener);
    }
  }

  append(node, children);
  return node;
}

/** A button that does not submit or take focus rings from form semantics. */
export function button(props: ElProps = {}, children: Child[] = []): HTMLButtonElement {
  return el('button', { ...props, type: 'button' }, children);
}

/** Append children, skipping null/false so callers can inline conditionals. */
export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Remove every child of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Set text only when it changed, to avoid needless layout work. */
export function setText(node: Element | null, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

/** Add or remove a class from a boolean. */
export function toggleClass(node: Element | null, name: string, on: boolean): void {
  node?.classList.toggle(name, on);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element.
 *
 * Separate from {@link el} because SVG elements have to be created against
 * their own namespace. An `<svg>` made with createElement looks right in the
 * document and draws nothing.
 */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  children: readonly Element[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  for (const child of children) node.appendChild(child);
  return node;
}
