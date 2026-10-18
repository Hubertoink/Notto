import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const project = process.env.MITTWALD_PROJECT_ID;
const identity = process.env.MITTWALD_SSH_IDENTITY_FILE;
if (!project || !identity || !process.env.MITTWALD_API_TOKEN)
  throw new Error('MITTWALD_PROJECT_ID, MITTWALD_SSH_IDENTITY_FILE and MITTWALD_API_TOKEN are required.');

async function mw(args) {
  const result = await execute('npx', ['--yes', '@mittwald/cli@1.26.0', ...args], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120000,
  });
  return result.stdout.trim();
}
const containers = JSON.parse(await mw(['container', 'list', '-p', project, '-o', 'json']));
function container(name) {
  const value = containers.find((item) => item.serviceName === name);
  if (!value || value.status !== 'running') throw new Error(`Container ${name} is not running.`);
  return value.id;
}
async function command(name, text) {
  return mw([
    'container',
    'exec',
    container(name),
    text,
    '-p',
    project,
    '--ssh-identity-file',
    identity,
    '-q',
  ]);
}
function integer(value) {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result)) throw new Error('Invalid storage measurement.');
  return result;
}
async function disk(name, path) {
  return integer((await command(name, `du -sk ${path}`)).split(/\s+/)[0]) * 1024;
}
const report = {
  measuredAt: new Date().toISOString(),
  registryBytes: await disk('registry', '/var/lib/registry'),
  attachmentBytes: await disk('app', '/data/attachments'),
  databaseVolumeBytes: await disk('db', '/var/lib/postgresql/data/pgdata'),
  databaseBytes: integer(
    await command('db', "psql -U notto -d notto -Atc 'SELECT pg_database_size(current_database())'"),
  ),
  registryTags: integer(
    await command(
      'registry',
      'find /var/lib/registry/docker/registry/v2/repositories/notto/_manifests/tags -mindepth 1 -maxdepth 1 -type d | wc -l',
    ),
  ),
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--publish-report')) {
  const encoded = Buffer.from(JSON.stringify(report)).toString('base64');
  await command(
    'app',
    `node --input-type=module -e 'import {writeFile,rename} from "node:fs/promises"; const path="/data/attachments/.hosting-storage"; await writeFile(path+".pending.json",Buffer.from("${encoded}","base64"),{mode:0o600}); await rename(path+".pending.json",path+".json");'`,
  );
  console.log('Published hosting report. Only the SETUP_EMAIL account can read it in Noto.');
}
