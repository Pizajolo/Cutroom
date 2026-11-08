export const MEDIA_DRAG_TYPE = 'application/x-cutroom-media';
export const MEDIA_SECTIONS = [
  { directory: 'raw', name: 'Footage', readOnly: true },
  { directory: 'references', name: 'References', readOnly: true },
  { directory: 'assets', name: 'Assets', readOnly: true },
  { directory: 'audio', name: 'Audio', readOnly: false },
  { directory: 'compositions', name: 'Compositions', readOnly: false },
  { directory: 'final', name: 'Exports', readOnly: false },
] as const;
export const IMPORT_DESTINATIONS = ['raw', 'references', 'assets'] as const;
export type ImportDestination = typeof IMPORT_DESTINATIONS[number];
export interface MediaFolder { id: string; root: string }
