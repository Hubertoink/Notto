import { spawn } from 'node:child_process';
import { dirname, join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

// Keep the application's dependencies untouched. Use the project's full video
// encoder instead of Windows' unrelated audio-only ffmpeg app alias.
const npmDirectory = process.env.npm_execpath
  ? dirname(process.env.npm_execpath)
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin');
const npx = join(npmDirectory, 'npx-cli.js');
if (!existsSync(npx)) throw new Error('Run this script through npm so its npx installation can be located.');
const args = process.argv.slice(2);
const child = spawn(process.execPath, [npx, '--yes', 'hyperframes@0.8.169', ...args], {
  stdio: 'inherit', windowsHide: true,
  env: {
    ...process.env,
    HYPERFRAMES_FFMPEG_PATH: ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: ffprobe.path,
    PATH: [dirname(ffmpeg), dirname(ffprobe.path), process.env.PATH].join(delimiter),
  },
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
