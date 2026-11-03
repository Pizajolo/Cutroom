import { z } from 'zod/v3';
import { Composition, registerRoot } from 'remotion';
import { RemotionTitle } from './Title';
export { RemotionTitle } from './Title';
// Export and the Inspector use the same data-cut-id keyed props contract.
export const schema = z.object({
  title: z.object({ content: z.string().default('Your title'), color: z.string().default('#ffffff'), fontSize: z.number().min(12).max(240).default(96) }).default({}),
  subtitle: z.object({ content: z.string().default('A story worth sharing') }).default({}),
});
const EditableTitle = (props: z.infer<typeof schema>) => <RemotionTitle title={props.title.content} subtitle={props.subtitle.content} color={props.title.color} fontSize={props.title.fontSize} />;
const Root = () => <Composition id="Title" component={EditableTitle} schema={schema} width={1920} height={1080} fps={30} durationInFrames={150} defaultProps={schema.parse({})} />;
registerRoot(Root);
