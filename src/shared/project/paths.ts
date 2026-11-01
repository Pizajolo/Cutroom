// Project paths are literal filesystem names. Only HTTP boundaries decode URL input.
export function isProjectPath(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && !value.includes('\\') &&
    !value.startsWith('/') && !/^[a-zA-Z]:/.test(value) &&
    !value.split('/').some((part) => part === '..' || part === '.' || part === '');
}
