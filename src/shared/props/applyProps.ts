import { propsDocSchema, type PropsDoc } from '../schema/props';

export type PropValues = Record<string, Record<string, unknown>>;
export interface PropElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  style?: { setProperty(name: string, value: string): void };
}
export interface PropDocument { querySelectorAll(selector: string): ArrayLike<PropElement> }
function localSource(value: string): boolean {
  try { const decoded = decodeURIComponent(value); return !!decoded && !decoded.startsWith('/') && !decoded.includes('\\') && !decoded.includes(':') && ![...decoded].some((char) => char.charCodeAt(0) < 32) && !decoded.split(/[/?#]/).some((part) => part === '..' || part === '.'); } catch { return false; }
}
/** The same bindings are used in preview and in temporary render documents. Never uses innerHTML. */
export function applyProps(document: PropDocument, schema: PropsDoc, values: PropValues): void {
  const parsed = propsDocSchema.parse(schema); const nodes = Array.from(document.querySelectorAll('[data-cut-id]')); const changes: (() => void)[] = [];
  for (const [id, properties] of Object.entries(values)) {
    const element = parsed.elements.find((element) => element.id === id); if (!element || Object.keys(properties).some((name) => !Object.hasOwn(element.props, name))) throw new Error('Unknown editable property');
  }
  for (const element of parsed.elements) {
    const node = nodes.find((node) => node.getAttribute('data-cut-id') === element.id); if (!node) continue;
    for (const [name, prop] of Object.entries(element.props)) {
      const supplied = values[element.id]; const value = supplied && Object.hasOwn(supplied, name) ? supplied[name] : prop.default;
      const expected = prop.type === 'number' ? 'number' : prop.type === 'boolean' ? 'boolean' : 'string';
      if (typeof value !== expected) throw new Error(`Invalid property type: ${element.id}.${name}`);
      if (typeof value === 'number' && (!Number.isFinite(value) || (prop.min !== undefined && value < prop.min) || (prop.max !== undefined && value > prop.max))) throw new Error(`Property out of bounds: ${name}`);
      if (prop.type === 'enum' && !prop.options?.includes(String(value))) throw new Error(`Invalid property option: ${name}`);
      const text = String(value);
      if (prop.bind === 'text') changes.push(() => { node.textContent = text; });
      else if (prop.bind.startsWith('css:--')) {
        if (/url\s*\(|expression\s*\(|[{};\\]|@import/i.test(text) || !node.style) throw new Error('Unsafe or unsupported CSS binding');
        changes.push(() => node.style!.setProperty(prop.bind.slice(4), text));
      } else if (prop.bind.startsWith('attr:data-prop-')) changes.push(() => node.setAttribute(prop.bind.slice(5), text));
      else if (prop.bind === 'src') { if (!localSource(text)) throw new Error('Image source must remain inside the composition'); changes.push(() => node.setAttribute('src', text)); }
      else throw new Error('Unknown property binding');
    }
  }
  for (const change of changes) change();
}
