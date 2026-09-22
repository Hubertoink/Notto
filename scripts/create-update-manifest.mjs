import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2] || 'release-assets';
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;

if (!repository || !tag) throw new Error('GITHUB_REPOSITORY und GITHUB_REF_NAME werden benötigt.');

const files = readdirSync(directory);
const windows = files.find((name) => name.endsWith('-setup.exe'));
const linux = files.find((name) => name.endsWith('.AppImage'));

if (!windows || !linux) throw new Error('Windows- oder Linux-Updatepaket fehlt.');

function signature(name) {
  return readFileSync(join(directory, `${name}.sig`), 'utf8').trim();
}

function downloadUrl(name) {
  return `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

const manifest = {
  version: tag.replace(/^v/i, ''),
  notes: `Noto ${tag.replace(/^v/i, '')}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: signature(windows),
      url: downloadUrl(windows),
    },
    'linux-x86_64': {
      signature: signature(linux),
      url: downloadUrl(linux),
    },
  },
};

writeFileSync(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
