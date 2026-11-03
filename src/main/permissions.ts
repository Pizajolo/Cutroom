export interface AudioPermissionRequest { permission: string; origin: string; mainFrame: boolean; mediaTypes?: readonly string[] }
export function allowAudioPermission(request: AudioPermissionRequest, appUrl = 'app://cutroom/'): boolean {
  if (request.permission !== 'media' || !request.mainFrame || request.mediaTypes?.length !== 1 || request.mediaTypes[0] !== 'audio') return false;
  try {
    const actual = new URL(request.origin); const expected = new URL(appUrl);
    return actual.protocol === expected.protocol && actual.host === expected.host && !actual.username && !actual.password;
  } catch { return false; }
}
