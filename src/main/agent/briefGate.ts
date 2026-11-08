export function needsBrief(input: { text: string; referenceCount: number; hasUrl: boolean; itemCount: number; skillId?: string }): boolean {
  return input.text.trim().split(/\s+/u).filter(Boolean).length < 12 && !input.hasUrl && input.referenceCount === 0 && input.itemCount === 0 && !input.skillId;
}
