// AI generation: stills, b-roll, lip sync, subject cutouts — through fal.ai, OpenRouter, Alibaba Cloud or the ChatGPT sign-in (Codex).
// Models all take different inputs, so this stays generic: the provider's own JSON in, one media file out.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from './run';

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};
const mime = (file: string): string => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
const isImage = (file: string): boolean => mime(file).startsWith('image/');
const wait = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

type Json = Record<string, unknown>;

/** An authenticated JSON request. `auth` is the full Authorization header value. */
async function call<T>(url: string, auth: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text) as T;
}

function key(name: string, provider: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${provider} is not connected for this feature. The user can connect it in Settings.`);
  return value;
}

/** Replace every string that names an existing project file with something the provider can read. */
async function withFiles(root: string, value: unknown, toUrl: (file: string) => Promise<string>): Promise<unknown> {
  if (typeof value === 'string') {
    const file = path.resolve(root, value);
    return !/^(https?|data):/.test(value) && path.extname(value) && existsSync(file) ? toUrl(file) : value;
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => withFiles(root, v, toUrl)));
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await withFiles(root, v, toUrl)] as const));
    return Object.fromEntries(entries);
  }
  return value;
}
const dataUrl = async (file: string): Promise<string> => `data:${mime(file)};base64,${(await readFile(file)).toString('base64')}`;

/** Every http(s) link stored under a key ending in "url", in order. */
const urls = (value: unknown): string[] =>
  !value || typeof value !== 'object'
    ? []
    : Object.entries(value).flatMap(([k, v]) => (/url$/i.test(k) && typeof v === 'string' && v.startsWith('http') ? [v] : urls(v)));

/** Poll `check` until it returns a result; it returns undefined while the job is still running. */
async function poll<T>(every: number, check: () => Promise<T | undefined>): Promise<T> {
  for (const started = Date.now(); ; await wait(every)) {
    const done = await check();
    if (done !== undefined) return done;
    if (Date.now() - started > 20 * 60_000) throw new Error('Generation timed out after 20 minutes.');
  }
}

/** A provider runs one model and returns the result: file bytes, or the links it produced. */
type Provider = {
  run(root: string, model: string, input: Json, out: string): Promise<Buffer | string[]>;
  schema(model: string): Promise<string>;
};

const fal: Provider = {
  async run(root, model, input) {
    const auth = `Key ${key('FAL_KEY', 'fal.ai')}`;
    const upload = async (file: string): Promise<string> => {
      const target = await call<{ upload_url: string; file_url: string }>('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', auth, {
        method: 'POST',
        body: JSON.stringify({ content_type: mime(file), file_name: path.basename(file) }),
      });
      const put = await fetch(target.upload_url, { method: 'PUT', body: new Uint8Array(await readFile(file)), headers: { 'Content-Type': mime(file) } });
      if (!put.ok) throw new Error(`Upload of ${path.basename(file)} failed (${put.status}).`);
      return target.file_url;
    };
    const job = await call<{ status_url: string; response_url: string }>(`https://queue.fal.run/${model}`, auth, {
      method: 'POST',
      body: JSON.stringify(await withFiles(root, input, upload)),
    });
    await poll(3, async () => {
      const { status, error } = await call<{ status: string; error?: string }>(job.status_url, auth);
      if (error) throw new Error(`Generation failed: ${error}`);
      return status === 'COMPLETED' || undefined;
    });
    return urls(await call<unknown>(job.response_url, auth));
  },
  async schema(model) {
    const res = await fetch(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(model)}`);
    if (!res.ok) throw new Error(`No such fal.ai model: ${model}`);
    const { components } = (await res.json()) as { components: { schemas: Record<string, { properties?: unknown; required?: string[] }> } };
    return Object.entries(components.schemas)
      .filter(([name]) => !/^Queue|ValidationError/.test(name))
      .map(([name, s]) => `${name}${s.required ? ` (required: ${s.required.join(', ')})` : ''}\n${JSON.stringify(s.properties ?? s)}`)
      .join('\n\n');
  },
};

const OPENROUTER = 'https://openrouter.ai/api/v1';
const openrouter: Provider = {
  async run(root, model, input, out) {
    const auth = `Bearer ${key('OPENROUTER_API_KEY', 'OpenRouter')}`;
    const body = JSON.stringify({ model, ...((await withFiles(root, input, dataUrl)) as Json) });
    if (isImage(out)) {
      const { data } = await call<{ data: { b64_json: string }[] }>(`${OPENROUTER}/images`, auth, { method: 'POST', body });
      return Buffer.from(data[0]!.b64_json, 'base64');
    }
    const job = await call<{ id: string }>(`${OPENROUTER}/videos`, auth, { method: 'POST', body });
    await poll(10, async () => {
      const { status, error } = await call<{ status: string; error?: unknown }>(`${OPENROUTER}/videos/${job.id}`, auth);
      if (status === 'failed') throw new Error(`Generation failed: ${JSON.stringify(error)}`);
      return status === 'completed' || undefined;
    });
    const video = await fetch(`${OPENROUTER}/videos/${job.id}/content?index=0`, { headers: { Authorization: auth } });
    if (!video.ok) throw new Error(`Download failed (${video.status}).`);
    return Buffer.from(await video.arrayBuffer());
  },
  async schema(model) {
    const { data } = (await (await fetch(`${OPENROUTER}/videos/models`)).json()) as { data?: ({ id: string } & Json)[] };
    const video = data?.find((m) => m.id === model);
    return video
      ? `Video model. Send {"prompt": …} plus any of these; a start image goes in "frame_images": [{"type":"image_url","image_url":{"url":"<file>"},"frame_type":"first_frame"}].\n${JSON.stringify(video)}`
      : 'Image model. Send {"prompt": …}, optionally "aspect_ratio", "resolution", "quality", and for edits "input_references": [{"type":"image_url","image_url":{"url":"<file>"}}].';
  },
};

const DASHSCOPE = 'https://dashscope-intl.aliyuncs.com/api/v1';
const alibaba: Provider = {
  async run(root, model, { endpoint, ...input }, out) {
    const auth = `Bearer ${key('DASHSCOPE_API_KEY', 'Alibaba Cloud')}`;
    const service = typeof endpoint === 'string' ? endpoint : isImage(out) ? 'text2image/image-synthesis' : 'video-generation/video-synthesis';
    const task = await call<{ output: { task_id: string } }>(`${DASHSCOPE}/services/aigc/${service}`, auth, {
      method: 'POST',
      headers: { 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model, ...((await withFiles(root, input, dataUrl)) as Json) }),
    });
    return poll(10, async () => {
      const { output } = await call<{ output: { task_status: string; message?: string } }>(`${DASHSCOPE}/tasks/${task.output.task_id}`, auth);
      if (output.task_status === 'FAILED') throw new Error(`Generation failed: ${output.message ?? 'unknown reason'}`);
      return output.task_status === 'SUCCEEDED' ? urls(output) : undefined;
    });
  },
  schema: async () =>
    'Send {"input": {"prompt": …, "negative_prompt"?, "img_url"? (start image for image-to-video), "audio_url"?}, ' +
    '"parameters": {"resolution": "720P"|"1080P", "ratio": "9:16"|"16:9"|"1:1", "duration": 2–15, "prompt_extend": true}}. ' +
    'Stills use "parameters": {"size": "1024*1024", "n": 1}. If the model needs another service path, add ' +
    '"endpoint": "<path after /services/aigc/>" (see the model page in Alibaba Cloud Model Studio).',
};

/** Stills through the user's ChatGPT sign-in: Codex has a built-in image tool, so it is asked to make the picture and save it. */
const codex: Provider = {
  async run(root, _model, input, out) {
    if (!isImage(out)) throw new Error('The ChatGPT sign-in generates stills only (png, jpg, webp).');
    const file = path.resolve(root, out);
    await mkdir(path.dirname(file), { recursive: true });
    const references = ((input.images as string[] | undefined) ?? []).map((image) => path.resolve(root, image));
    const task =
      `Use your built-in image generation tool (not code, not an API script) to create one image, then save it as ${file} ` +
      `(convert the format if the extension needs it). Do nothing else.${references.length ? ' The attached images are the reference to work from.' : ''}` +
      `${input.aspect_ratio ? ` Aspect ratio: ${String(input.aspect_ratio)}.` : ''}\n\nImage: ${String(input.prompt)}`;
    await run('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', root, task, ...references.flatMap((image) => ['-i', image])]);
    if (!existsSync(file)) throw new Error('ChatGPT did not return an image. The user may need to sign in again in Settings › Codex.');
    return readFile(file);
  },
  schema: async () => 'Stills only. Send {"prompt": …, "aspect_ratio"?: "9:16" | "16:9" | "1:1", "images"?: ["assets/reference.png", …]} — "images" are references to edit or build on.',
};

const PROVIDERS: Record<string, Provider> = { fal, openrouter, alibaba, codex };

/** `fal:kling/v4/text-to-video` → the fal provider and its model id. */
function resolve(target: string): [Provider, string] {
  const [name, model] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
  if (name === 'theta') throw new Error('Theta EdgeCloud models run through the mcp__theta tools, not this command.');
  const provider = PROVIDERS[name];
  if (!provider || !model) throw new Error(`Name the model as <provider>:<model>, with provider one of ${Object.keys(PROVIDERS).join(', ')}.`);
  return [provider, model];
}

/** The inputs a model takes, so the caller knows what JSON to send. */
export const schema = (target: string): Promise<string> => {
  const [provider, model] = resolve(target);
  return provider.schema(model);
};

/** Run a model and save its output file. */
export async function generate(root: string, target: string, input: Json, out: string): Promise<string> {
  const [provider, model] = resolve(target);
  const result = await provider.run(root, model, input, out);
  const file = path.resolve(root, out);
  await mkdir(path.dirname(file), { recursive: true });
  if (Buffer.isBuffer(result)) await writeFile(file, result);
  else {
    // A model may return several files (a matte and a cutout, say): prefer the one of the requested type.
    const url = result.find((u) => new URL(u).pathname.endsWith(path.extname(out))) ?? result[0];
    if (!url) throw new Error('The model returned no file.');
    await writeFile(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  return path.relative(root, file);
}
