import { build } from 'vite';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';

const root = fileURLToPath(new URL('../', import.meta.url));
// Bundle to a fresh temporary folder so Node 22 needs no TS loader or version-specific stripping.
const temp = await mkdtemp(path.join(tmpdir(), 'cutroom-schemas-'));
try {
  const entry = path.join(root, 'src/shared/schema/index.ts');
  await build({
    configFile: false,
    build: { outDir: temp, emptyOutDir: false, lib: { entry, formats: ['es'], fileName: () => 'schemas.mjs' }, rollupOptions: { external: ['nanoid'] } },
  });
  const schemas = await import(pathToFileURL(path.join(temp, 'schemas.mjs')).href);
  const output = path.join(root, 'docs/schemas');
  await mkdir(output, { recursive: true });
  for (const [name, schema] of Object.entries({ timeline: schemas.timelineDocSchema, props: schemas.propsDocSchema, project: schemas.projectDocSchema, events: schemas.eventEnvelopeSchema, jobs: schemas.jobInfoSchema, settings: schemas.globalSettingsSchema, tools: schemas.toolInfoSchema, install: schemas.installStateSchema, models: schemas.whisperModelInfoSchema, accounts: schemas.accountInfoSchema, claudeCodeStatus: schemas.claudeCodeStatusSchema })) {
    const file = path.join(output, `${name}.schema.json`);
    const generated = `${JSON.stringify(zodToJsonSchema(schema, { name, target: 'jsonSchema7', $refStrategy: 'none' }), null, 2)}\n`;
    // Generated schema artifacts only, never project/user files.
    const old = await readFile(file, 'utf8').catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (old !== generated) await writeFile(file, generated);
    console.log(path.relative(root, file));
  }
} finally { await rm(temp, { recursive: true }); }
