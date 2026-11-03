import { z } from 'zod/v3';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
export const schema = z.object({ title: z.string().default('Your title'), subtitle: z.string().default('A story worth sharing'), color: z.string().default('#ffffff'), fontSize: z.number().min(12).max(240).default(96) });
export type TitleProps = z.infer<typeof schema>;
export function RemotionTitle({ title = 'Your title', subtitle = 'A story worth sharing', color = '#ffffff', fontSize = 96 }: Partial<TitleProps>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: 'Arial, sans-serif', color }}><div style={{ width: '80%', textAlign: 'center', opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), translate: `0 ${interpolate(frame, [0, 0.5 * fps], [24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px` }}><h1 data-cut-id="title" style={{ fontSize, margin: 0, lineHeight: 1.15 }}>{title}</h1><p data-cut-id="subtitle" style={{ fontSize: fontSize * 0.44, marginTop: 32 }}>{subtitle}</p></div></AbsoluteFill>;
}
