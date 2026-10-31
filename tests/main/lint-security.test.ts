import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import noShell from '../../scripts/eslint-no-shell.mjs';

const lint = (code: string) => new Linter().verify(code, {
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: { security: { rules: { 'no-shell': noShell } } },
  rules: { 'security/no-shell': 'error' },
});

describe('shell execution lint guard', () => {
  it.each([
    "import { exec as run } from 'node:child_process'; run('ls');",
    "import * as cp from 'node:child_process'; cp.exec('ls');",
    "import cp from 'child_process'; cp['execSync']('ls');",
    "const {exec: run} = require('node:child_process'); run('ls');",
    "const cp = require('child_process'); cp.exec('ls');",
    "require('child_process').exec('ls');",
    "import * as cp from 'node:child_process'; const {exec} = cp; exec('ls');",
    "spawn('ffmpeg', [], {shell: true});",
    "spawn('ffmpeg', [], {'shell': true});",
    "spawn('ffmpeg', [], {['shell']: true});",
  ])('rejects %s', (code) => { expect(lint(code).some((message) => message.ruleId === 'security/no-shell')).toBe(true); });
  it.each([
    "import {spawn} from 'node:child_process'; spawn('ffmpeg', ['-version']);",
    "import {execFile} from 'node:child_process'; execFile('ffprobe', ['-version']);",
    "spawn('ffmpeg', [], {shell: false});",
    "const pattern = /x/; pattern.exec('text');",
  ])('allows %s', (code) => { expect(lint(code)).toEqual([]); });
});
