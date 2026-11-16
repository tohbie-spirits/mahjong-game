/**
 * _screenKit.js — small DOM helpers shared by the rebuilt screen components
 * (button, heading, element). Internal to src/ui/components.
 */

export function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className, text, onClick) {
  const b = h('button', className, text);
  b.type = 'button';
  if (typeof onClick === 'function') b.addEventListener('click', onClick);
  return b;
}

export function assertContainer(container, name) {
  if (!(container instanceof Element)) throw new TypeError(`[${name}] container must be a DOM Element.`);
}
