export interface OperationSummary { text: string; truncated: boolean }
const REDACTED = '[redacted]';
const secretKey = /(?:password|passwd|secret|token|api[-_]?key|access[-_]?key|authorization|cookie|credential|private[-_]?key)/i;

function redactText(text: string): string {
  return text
    .replace(/-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?(?:-----END [\w ]*PRIVATE KEY-----|$)/g, REDACTED)
    .replace(/\b(?:sk-(?:ant-)?[\w-]{8,}|gh[pousr]_[\w]{8,})\b/g, REDACTED)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\b(Bearer|Basic)\s+[\w+/.=~-]+/gi, `$1 ${REDACTED}`)
    .replace(/((?:[\w-]*(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization|cookie|credential|private[-_]?key)[\w-]*)["']?\s*(?:=|:|\s)\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s&;,}\]]+)/gi, `$1${REDACTED}`)
    .replace(/./gu, (char) => {
      const code = char.charCodeAt(0);
      const invisible = code >= 0x200b && code <= 0x200f || code >= 0x202a && code <= 0x202e || code >= 0x2060 && code <= 0x2069 || code === 0xfeff;
      return invisible ? `\\u${code.toString(16).padStart(4, '0')}` : char;
    });
}

/** Display data only: bounded, never interpreted as HTML, a link, or executable input. */
export function summarizeOperation(input: Record<string, unknown>): OperationSummary {
  let truncated = false, remainingChars = 16000, remainingNodes = 200;
  const seen = new WeakSet<object>();
  const displayText = (value: string) => {
    const limit = Math.min(8000, remainingChars);
    const bounded = value.slice(0, limit); remainingChars -= bounded.length;
    const omitted = bounded.length < value.length;
    if (omitted) truncated = true;
    return `${redactText(bounded)}${omitted ? '… [truncated]' : ''}`;
  };
  const visit = (value: unknown, depth: number, key = ''): unknown => {
    if (--remainingNodes < 0) { truncated = true; return '[details omitted]'; }
    if (secretKey.test(key) || /^(?:env|environment|headers)$/i.test(key)) return REDACTED;
    if (typeof value === 'string') return displayText(value);
    if (!value || typeof value !== 'object') return value;
    if (depth >= 6 || seen.has(value)) { truncated = true; return '[details omitted]'; }
    seen.add(value);
    const entries = Object.entries(value);
    if (entries.length > 50) truncated = true;
    if (Array.isArray(value)) return entries.slice(0, 50).map(([, entry]) => visit(entry, depth + 1));
    return Object.fromEntries(entries.slice(0, 50).map(([name, entry]) => [displayText(name), visit(entry, depth + 1, name)]));
  };
  let text = JSON.stringify(visit(input, 0), null, 2);
  if (text.length > 16000) { text = `${text.slice(0, 16000)}… [truncated]`; truncated = true; }
  return { text, truncated };
}
