// The `cutroom` command line. The agent (and the app itself) drive all rendering through it.
import path from 'node:path';
import { CUTOUT_USAGE, cutout } from './cutout';
import { generate, schema } from './generate';
import { activeCut, addLedger, saveExample } from './project';
import { render } from './render';
import { renderRemotion } from './remotion';
import { transcribe } from './transcribe';

const HELP = `cutroom — run inside a Cutroom project folder

  cutroom render [--preview]              Render the cut's timeline.json to exports/ (or the in-app preview)
  cutroom transcribe <file> [--lang xx]   Whisper transcript with word timestamps (default: auto-detect)
  cutroom remotion <entry> <id> <out.mov> [--props '{...}']
                                          Render a Remotion composition to a transparent overlay
  cutroom style-example <name> [--from s] [--to s] [--src file]
                                          Keep the current video (or a section, or a section of another file)
                                          as the example of a saved style or move
  cutroom ledger <file> --source "…" [--license "…"] [--note "…"]
                                          Record where a file came from and what may be done with it
  ${CUTOUT_USAGE.replaceAll('\n       ', '\n  ')}
                                          Cut the subject out on this Mac: a sticker (.png, from a picture or
                                          the frame at --at) or a video with the background gone (.mov)
  cutroom generate --schema <provider>:<model>
                                          Show the inputs a model takes (provider: fal, openrouter, alibaba, codex)
  cutroom generate <provider>:<model> '<json>' <out>
                                          Run a model; project files named in the JSON are sent along`;

async function main(): Promise<string> {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    return i < 0 ? undefined : rest.splice(i, 2)[1];
  };
  const root = process.cwd();
  switch (command) {
    case 'render': {
      const out = await render(root, await activeCut(root), { preview: rest.includes('--preview') });
      return `Rendered ${path.relative(root, out)}`;
    }
    case 'transcribe': {
      const lang = flag('--lang');
      if (!rest[0]) throw new Error('Usage: cutroom transcribe <file> [--lang xx]');
      return transcribe(root, rest[0], lang);
    }
    case 'remotion': {
      const props = JSON.parse(flag('--props') ?? '{}') as Record<string, unknown>;
      const [entry, id, out] = rest;
      if (!entry || !id || !out) throw new Error("Usage: cutroom remotion <entry> <id> <out.mov> [--props '{...}']");
      return `Rendered ${path.relative(root, await renderRemotion(entry, id, out, props))}`;
    }
    case 'style-example': {
      const [src, from, to] = [flag('--src'), flag('--from'), flag('--to')];
      if (!rest[0]) throw new Error('Usage: cutroom style-example <name> [--from s] [--to s] [--src file]');
      const cut = await activeCut(root);
      if (!src) await render(root, cut, { preview: true });
      return `Saved ${await saveExample(root, cut, rest[0], { src, from: from ? Number(from) : undefined, to: to ? Number(to) : undefined })}`;
    }
    case 'ledger': {
      const [source, license, note] = [flag('--source'), flag('--license'), flag('--note')];
      if (!rest[0] || !source) throw new Error('Usage: cutroom ledger <file> --source "…" [--license "…"] [--note "…"]');
      await addLedger(root, { file: rest[0], source, license, note });
      return `Recorded ${rest[0]}`;
    }
    case 'cutout':
      return cutout(root, rest);
    case 'generate': {
      const model = flag('--schema');
      if (model) return schema(model);
      const [id, input, out] = rest;
      if (!id || !input || !out) throw new Error("Usage: cutroom generate <model> '<json>' <out>");
      const file = await generate(root, id, JSON.parse(input) as Record<string, unknown>, out);
      await addLedger(root, { file, source: `Generated with ${id}`, license: 'AI-generated' });
      return `Saved ${file}`;
    }
    default:
      return HELP;
  }
}

main().then(
  (message) => {
    console.log(message);
    process.exit(0);
  },
  (error: Error) => {
    console.error(error.message);
    process.exit(1);
  },
);
