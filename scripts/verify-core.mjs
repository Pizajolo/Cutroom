// Dependency-free development smoke probe; not a replacement for Electron/Vitest acceptance tests.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { tmpdir } from 'node:os';

const sourceRoot = pathToFileURL(fileURLToPath(new URL('../', import.meta.url))).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    if (!specifier.startsWith('node:') && !specifier.startsWith('.') && !specifier.startsWith('file:')) throw new Error(`Unexpected external dependency: ${specifier}`);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }), shortCircuit: true };
    return next(url, context);
  },
});
const { ToolRegistry } = await import('../src/main/tools/registry.ts');
const { startMediaServer, parseRange } = await import('../src/main/server/mediaServer.ts');
const { importPaths } = await import('../src/main/media/import.ts');
const { runTool, stopMediaProcesses } = await import('../src/main/media/process.ts');
const { writeCache } = await import('../src/main/media/cache.ts');
const temporary = await fs.mkdtemp(path.join(tmpdir(), 'cutroom-core-probe-'));
let server;
try {
  const bundledRoot = path.join(temporary, 'bundle'); await fs.mkdir(bundledRoot);
  const binary = path.join(bundledRoot, 'ffmpeg'); await fs.writeFile(binary, 'fixture1', { mode: 0o755 });
  const pin = { name: 'ffmpeg', version: '1.0.0', arch: 'arm64', bundled: true, sourceUrl: 'https://example.com/f.zip', checksumUrl: 'https://example.com/f.sha256', archiveSha256: 'a'.repeat(64), sha256: createHash('sha256').update('fixture1').digest('hex') };
  const registry = new ToolRegistry({ home: path.join(temporary, 'home'), bundledRoot, arch: 'arm64', manifest: { schemaVersion: 1, tools: [pin] } });
  await registry.initialize(); assert.equal(await registry.resolve('ffmpeg'), binary);
  await fs.writeFile(binary, 'fixture2'); assert.equal((await registry.list())[0].status, 'checksum_mismatch');
  await assert.rejects(fs.lstat(path.join(temporary, 'home/bin/ffmpeg')), { code: 'ENOENT' });
  console.log('PASS: actual SHA256 verification/cache, mutation refusal, stale managed-link removal');
  assert.deepEqual(parseRange('bytes=-4', 10), { start: 6, end: 9 }); assert.equal(parseRange('bytes=10-', 10), 'unsatisfiable');
  const root = path.join(temporary, 'project'); await fs.mkdir(path.join(root, 'raw'), { recursive: true }); await fs.writeFile(path.join(root, 'raw/clip.mp4'), '0123456789');
  await fs.mkdir(path.join(temporary, 'project-outside')); await fs.writeFile(path.join(temporary, 'project-outside/secret'), 'secret'); await fs.symlink(path.join(temporary, 'project-outside'), path.join(root, 'escape'));
  const source = path.join(temporary, 'source.mp4'); await fs.writeFile(source, 'original-source-bytes');
  assert.deepEqual(await importPaths(root, [source], 'raw'), ['raw/source.mp4']);
  assert.deepEqual(await importPaths(root, [source], 'raw'), ['raw/source-1.mp4']);
  assert.equal(await fs.readFile(source, 'utf8'), 'original-source-bytes');
  assert.equal(await fs.readFile(path.join(root, 'raw/source.mp4'), 'utf8'), 'original-source-bytes');
  const before = await fs.readdir(path.join(root, 'raw'));
  await assert.rejects(importPaths(root, [source, path.join(temporary, 'absent')], 'raw'));
  assert.deepEqual(await fs.readdir(path.join(root, 'raw')), before);
  console.log('PASS: source-preserving copy, unique names, batch preflight before mutation');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 50);
  try { await assert.rejects(runTool(async () => process.execPath, 'ffmpeg', ['-e', 'setInterval(() => {},1000)'], { signal: controller.signal }), { details: { kind: 'cancelled' } }); }
  finally { clearTimeout(timer); }
  await assert.rejects(runTool(async () => process.execPath, 'ffprobe', ['-e', 'process.stdout.write("x".repeat(8192))'], { maxOutputBytes: 32 }), { details: { kind: 'output_limit' } });
  const canonical = await fs.realpath(root); await fs.mkdir(path.join(root, 'work')); await fs.symlink(path.join(root, 'raw'), path.join(root, 'work/.cutroom-media'));
  await assert.rejects(writeCache({ root: canonical, resolveTool: async () => binary, url: (rel) => rel }, `work/.cutroom-media/${'a'.repeat(64)}.probe.json`, { unsafe: true }));
  assert.equal(await fs.readFile(source, 'utf8'), 'original-source-bytes');
  console.log('PASS: real child cancellation/output limits and cache-to-source alias refusal');
  if (!process.argv.includes('--filesystem-only')) {
  server = await startMediaServer({ projectRoot: (id) => id === 'p' ? root : undefined, devOrigin: 'http://127.0.0.1:5173' });
  const url = new URL(server.baseUrl);
  const get = (relative, headers = {}, method = 'GET', tokenPrefix = url.pathname) => new Promise((resolve, reject) => {
    const client = request({ hostname: url.hostname, port: url.port, path: `${tokenPrefix}/p/p/${relative}`, headers, method, agent: false }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString(), headers: response.headers }));
    }); client.on('error', reject); client.end();
  });
  assert.equal((await get('raw/clip.mp4')).body, '0123456789');
  assert.equal((await get('raw/clip.mp4', {}, 'HEAD')).body, '');
  for (const [range, body] of [['bytes=2-5', '2345'], ['bytes=-4', '6789'], ['bytes=7-', '789'], ['bytes=8-99', '89']]) {
    const ranged = await get('raw/clip.mp4', { Range: range }); assert.equal(ranged.status, 206); assert.equal(ranged.body, body);
  }
  for (const range of ['bytes=10-', 'bytes=-0', 'bytes=4-2', 'bytes=0-1,4-5']) assert.equal((await get('raw/clip.mp4', { Range: range })).status, 416);
  for (const rel of ['../project-outside/secret', '%2e%2e/project-outside/secret', '%252e%252e/project-outside/secret', 'escape/secret', '%2Fetc/passwd', 'raw/%00.mp4']) assert.equal((await get(rel)).status, 403);
  assert.equal((await get('raw/clip.mp4', {}, 'GET', '/k/wrong')).status, 403);
  assert.equal((await get('raw/clip.mp4', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await get('raw/clip.mp4', { Origin: 'app://cutroom' })).headers['access-control-allow-origin'], 'app://cutroom');
  assert.equal((await get('raw/clip.mp4', { Origin: 'http://127.0.0.1:5173' }, 'OPTIONS')).status, 204);
  assert.equal((await get('raw/clip.mp4', {}, 'POST')).status, 405);
  console.log('PASS: real loopback HTTP/HEAD, 206/416, token/CORS, traversal and sibling/symlink refusal');
  } else console.log('NOT RUN: HTTP probe (--filesystem-only); full probe requires local binding permission.');
} finally {
  await stopMediaProcesses();
  if (server) await server.close(); await fs.rm(temporary, { recursive: true, force: true }); hook.deregister();
}
