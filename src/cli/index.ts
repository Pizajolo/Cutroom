// The `cutroom` command line. The agent (and the app itself) drive all rendering through it.
import path from 'node:path';
import { generate, schema } from './generate';
import { render } from './render';
import { renderRemotion } from './remotion';
import { transcribe } from './transcribe';

const HELP = `cutroom — run inside a Cutroom project folder

  cutroom render [--preview]              Render .cutroom/timeline.json to exports/ (or the in-app preview)
  cutroom transcribe <file> [--lang xx]   Whisper transcript with word timestamps (default: auto-detect)
  cutroom remotion <entry> <id> <out.mov> [--props '{...}']
                                          Render a Remotion composition to a transparent overlay
  cutroom generate --schema <provider>:<model>
                                          Show the inputs a model takes (provider: fal, openrouter, alibaba)
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
      const out = await render(root, { preview: rest.includes('--preview') });
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
    case 'generate': {
      const model = flag('--schema');
      if (model) return schema(model);
      const [id, input, out] = rest;
      if (!id || !input || !out) throw new Error("Usage: cutroom generate <model> '<json>' <out>");
      return `Saved ${await generate(root, id, JSON.parse(input) as Record<string, unknown>, out)}`;
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
