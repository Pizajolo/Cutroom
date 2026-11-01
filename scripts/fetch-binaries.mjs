import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withToolRuntime } from './tool-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestFile = path.join(root, 'resources/tools-manifest.json');
const pinning = process.argv.includes('--pin');
const arch = process.argv.find((arg) => arg.startsWith('--arch='))?.slice(7);
if (arch && !['arm64', 'x64'].includes(arch)) throw new Error('Expected --arch=arm64 or --arch=x64');
try {
  await withToolRuntime(async ({ parseManifest, download, checksumFromText, sha256, verifyArchitecture, extractZip, clearQuarantine, publishExclusive, atomicJson, managedDirectory }) => {
    const manifest = parseManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
    for (const pin of manifest.tools.filter((pin) => pin.source.format !== 'build' && (!arch || pin.arch === arch || pin.arch === 'universal'))) {
      if ((!pin.archiveSha256 || !pin.sha256) && !pinning) throw new Error(`${pin.name}/${pin.arch}: unresolved checksums. Run npm run fetch:binaries -- --pin, then review and commit the resulting pins before distributing.`);
      const temp = await mkdtemp(path.join(tmpdir(), 'cutroom-binary-download-'));
      const signal = AbortSignal.timeout(600_000);
      try {
        const downloads = path.join(temp, 'downloads'); const extracted = path.join(temp, 'extracted'); await mkdir(downloads); await mkdir(extracted);
        let expected = pin.archiveSha256;
        if (!expected) {
          const checksum = path.join(downloads, 'checksums');
          await download({ url: pin.checksum.url, file: checksum, policy: pin, limit: 1024 * 1024, signal });
          expected = checksumFromText(await readFile(checksum, 'utf8'), pin.checksum.format, pin.checksum.entry);
        }
        const archive = path.join(downloads, 'archive');
        const result = await download({ url: pin.source.url, file: archive, policy: pin, limit: 512 * 1024 * 1024, signal });
        if (result.sha256 !== expected) throw new Error('Archive checksum mismatch.');
        const binary = path.join(extracted, pin.name);
        if (pin.source.format === 'zip') await extractZip(archive, pin.source.entry, binary, signal); else await copyFile(archive, binary);
        for (const targetArch of pin.arch === 'universal' ? ['arm64', 'x64'] : [pin.arch]) await verifyArchitecture(binary, targetArch);
        const actual = await sha256(binary); if (pin.sha256 && actual !== pin.sha256) throw new Error('Executable checksum mismatch.');
        pin.archiveSha256 = result.sha256; pin.sha256 = actual;
        // Universal download-only tools belong to the runtime installer, not the bundle.
        if (pin.bundled) {
          const target = await managedDirectory(root, 'resources', 'bin', pin.arch);
          await chmod(binary, 0o755); await clearQuarantine(binary, signal); await publishExclusive(binary, path.join(target, pin.name), actual);
        }
        if (pinning) await atomicJson(manifestFile, manifest);
        console.log(`Verified ${pin.name}/${pin.arch} ${pin.version}: archive ${result.sha256}; executable ${actual}`);
      } finally { await rm(temp, { recursive: true, force: true }); }
    }
  });
} catch (error) { console.error(error instanceof Error ? error.message : 'Binary fetch failed.'); process.exitCode = 1; }
