import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
const env = { ...process.env };
const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
env[key] = join(homedir(), '.cargo', 'bin') + delimiter + (env[key] || '');
const child = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
