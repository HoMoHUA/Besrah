// Minimal test-only DOM: run the real view, DOM helper and event handlers in Node.
// No view/permission/network logic is implemented here.
class TestNode {
  constructor(tagName = '', text = '') {
    this.tagName = tagName;
    this.text = text;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  set innerHTML(value) {
    if (value !== '') throw new Error('test DOM only supports clearing markup');
    this.replaceChildren();
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.text = ''; this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  async dispatch(name, value) {
    if (this.getAttribute('disabled') !== null) throw new Error('disabled control');
    if (value !== undefined) this.value = value;
    await this.listeners.get(name)?.({ type: name, target: this });
  }
}

export function findAll(root, predicate) {
  return root.children.flatMap(child => [ ...(predicate(child) ? [child] : []), ...findAll(child, predicate) ]);
}
export function byClass(root, name) {
  return findAll(root, node => node.className.split(' ').includes(name))[0];
}
export function button(root, text) {
  const node = findAll(root, node => node.tagName === 'button' && node.textContent === text)[0];
  if (!node) throw new Error('button not found: ' + text);
  return node;
}
export const flushView = () => new Promise(resolve => setImmediate(resolve));

export function installFoodDom(t, { browser, native } = {}) {
  const globals = {
    Node: TestNode,
    document: { createElement: tag => new TestNode(tag), createTextNode: text => new TestNode('', text) },
    navigator: { userAgent: 'node-test', ...(browser ? { geolocation: { getCurrentPosition: browser } } : {}) },
    window: native ? { Telegram: { WebApp: native } } : {},
    // Any accidental persistence/network operation must fail the test.
    localStorage: { setItem() { throw new Error('food must not persist location'); }, getItem() { throw new Error('food must not read location storage'); } },
    fetch: () => { throw new Error('unexpected real fetch'); },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}
