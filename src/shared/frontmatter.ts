// SKILL.md frontmatter: the `key: value` lines between the two `---` at the top.
// Claude Code and the marketplace read it as YAML, where a plain value can't contain ": " (`description: Punch-in: a
// quick zoom…`) or start with "@" (`source: @creator`). Cutroom writes such values in double quotes.

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;
const LINE = /^([A-Za-z][\w-]*):[ \t]*(.*)$/;

/** A value YAML would misread unless it is quoted. */
const needsQuotes = (value: string): boolean =>
  /: |:$| #|\t/.test(value) || /^[@`!&*%|>?{}[\],#'"]|^- |^-$|^~$/.test(value) || /^(true|false|yes|no|on|off|null)$/i.test(value);

const unquote = (value: string): string => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

/** One field of the frontmatter, unquoted; '' when it isn't there. */
export function frontmatterField(text: string, key: string): string {
  const block = BLOCK.exec(text)?.[1] ?? '';
  for (const line of block.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] === key) return unquote(match[2]!.trim());
  }
  return '';
}

/** The same SKILL.md with every frontmatter value that YAML would misread put in double quotes. */
export function cleanFrontmatter(text: string): string {
  const match = BLOCK.exec(text);
  if (!match) return text;
  const lines = match[1]!.split(/\r?\n/).map((line) => {
    const field = LINE.exec(line);
    const value = field?.[2]?.trim() ?? '';
    // Leave alone what is already quoted, block scalars (`|`, `>`) and nested YAML on the next lines.
    if (!field || !value || /^(["']).*\1$/.test(value) || /^[|>][-+]?$/.test(value) || !needsQuotes(value)) return line;
    return `${field[1]}: ${JSON.stringify(value)}`;
  });
  return text.replace(match[1]!, () => lines.join('\n'));
}
