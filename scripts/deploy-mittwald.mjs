import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { maintainRegistry } from './registry-retention.mjs';

const execute = promisify(execFile);
const pause = () => new Promise((resolve) => setTimeout(resolve, 5000));

export async function offlineCollection(operations) {
  let maintenance;
  try {
    // Mark the registry for recovery even if the stop request times out.
    await operations.stop();
    maintenance = await operations.create();
    await operations.wait(maintenance);
  } finally {
    // Stop/remove the collector before allowing registry writes again.
    await operations.remove(maintenance);
    await operations.start();
  }
}

export function deployedDigests(containers) {
  return [
    ...new Set(
      ['app', 'worker'].flatMap((name) => {
        const matches = containers.filter((item) => item.serviceName === name);
        const container = matches[0];
        if (matches.length !== 1 || container.status !== 'running' || container.requiresRecreate)
          throw new Error(`${name} must be running with no pending deployment.`);
        const values = [container.deployedState?.imageDigest, container.pendingState?.imageDigest];
        if (values.some((value) => !/^sha256:[a-f0-9]{64}$/.test(value || '')))
          throw new Error(`${name} has no verified deployed/pending digest.`);
        return values;
      }),
    ),
  ];
}

export async function deployMittwald(env = process.env) {
  const { MITTWALD_API_TOKEN, MITTWALD_PROJECT_ID, NOTTO_IMAGE } = env;
  if (!MITTWALD_API_TOKEN || !MITTWALD_PROJECT_ID || !NOTTO_IMAGE)
    throw new Error('MITTWALD_API_TOKEN, MITTWALD_PROJECT_ID and NOTTO_IMAGE are required.');
  if (!/^[a-zA-Z0-9.-]+\/notto:[a-zA-Z0-9_.-]+$/.test(NOTTO_IMAGE))
    throw new Error('NOTTO_IMAGE must be a tagged notto image.');
  const registryHost = NOTTO_IMAGE.split('/')[0];
  const project = ['-p', MITTWALD_PROJECT_ID];
  const keyName = `noto-deploy-${randomUUID()}`;
  const identity = join(homedir(), '.ssh', keyName);
  const cliEnv = { ...env, MITTWALD_SSH_IDENTITY_FILE: identity };
  async function mw(args) {
    try {
      const { stdout } = await execute('npx', ['--yes', '@mittwald/cli@1.26.0', ...args], {
        env: cliEnv,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout.trim();
    } catch {
      // CLI error output can include container environments. Do not expose it in Actions logs.
      throw new Error(`Mittwald command failed: ${args.slice(0, 2).join(' ')}. Inspect mStudio for details.`);
    }
  }
  const list = async () => JSON.parse(await mw(['container', 'list', ...project, '-o', 'json']));
  function service(containers, name) {
    const matches = containers.filter((item) => item.serviceName === name);
    if (matches.length !== 1) throw new Error(`Expected one ${name} container.`);
    return matches[0];
  }
  async function waitFor(check, description) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await check()) return;
      await pause();
    }
    throw new Error(`Timed out: ${description}`);
  }
  async function health(origin) {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15000) });
    return (
      response.ok &&
      (await response.json()).version ===
        JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
    );
  }
  let registryAuth;
  async function verifyManifest(reference, checked = new Set()) {
    if (checked.has(reference)) return;
    checked.add(reference);
    const response = await fetch(
      `https://${registryHost}/v2/notto/manifests/${encodeURIComponent(reference)}`,
      {
        headers: registryAuth,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error(`Image manifest is not available (${response.status}).`);
    const manifest = await response.json();
    for (const child of manifest.manifests || []) await verifyManifest(child.digest, checked);
    for (const blob of [manifest.config, ...(manifest.layers || [])].filter(Boolean)) {
      const check = await fetch(`https://${registryHost}/v2/notto/blobs/${blob.digest}`, {
        method: 'HEAD',
        headers: registryAuth,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!check.ok) throw new Error(`Image blob is not available (${check.status}).`);
    }
  }
  await mkdir(join(homedir(), '.ssh'), { recursive: true, mode: 0o700 });
  try {
    await mw([
      'user',
      'ssh-key',
      'create',
      '--expires',
      '1h',
      '--output',
      keyName,
      '--no-passphrase',
      '--comment',
      keyName,
      '-q',
    ]);
    let containers = await list();
    deployedDigests(containers);
    const registry = service(containers, 'registry');
    if (
      registry.status !== 'running' ||
      !registry.deployedState.volumes.includes('registry-data:/var/lib/registry')
    )
      throw new Error('Registry must be running with the expected registry-data volume.');
    const credentials = registry.deployedState.envs;
    if (!credentials.REGISTRY_USER || !credentials.REGISTRY_PASSWORD)
      throw new Error('Registry credentials missing.');
    registryAuth = {
      Authorization: `Basic ${Buffer.from(`${credentials.REGISTRY_USER}:${credentials.REGISTRY_PASSWORD}`).toString('base64')}`,
      Accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
    };
    const origin = service(containers, 'app').deployedState.envs.APP_ORIGIN;
    if (!origin || new URL(origin).protocol !== 'https:') throw new Error('HTTPS app origin missing.');
    await verifyManifest(NOTTO_IMAGE.split(':').at(-1));
    for (const name of ['worker', 'app']) {
      const id = service(containers, name).id;
      console.log(`Updating ${name} image; preserving environment and volumes.`);
      await mw(['container', 'update', id, ...project, '--image', NOTTO_IMAGE, '--recreate', '-q']);
      await waitFor(async () => {
        const current = service(await list(), name);
        return (
          current.status === 'running' &&
          !current.requiresRecreate &&
          current.deployedState.image === NOTTO_IMAGE
        );
      }, `${name} deployment`);
    }
    await waitFor(async () => {
      try {
        return await health(origin);
      } catch {
        return false;
      }
    }, 'new web version health check');
    containers = await list();
    const digests = deployedDigests(containers);
    const put = await fetch(`https://${registryHost}/v2/notto/manifests/${NOTTO_IMAGE.split(':').at(-1)}`, {
      headers: registryAuth,
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!put.ok) throw new Error('Deployed tag is unavailable.');
    const latest = await fetch(`https://${registryHost}/v2/notto/manifests/latest`, {
      method: 'PUT',
      headers: { ...registryAuth, 'Content-Type': put.headers.get('content-type') },
      body: await put.text(),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!latest.ok) throw new Error('Could not update latest tag.');
    await maintainRegistry(
      {
        REGISTRY_URL: `https://${registryHost}`,
        REGISTRY_USER: credentials.REGISTRY_USER,
        REGISTRY_PASSWORD: credentials.REGISTRY_PASSWORD,
        REGISTRY_DEPLOYED_DIGESTS: digests.join(','),
      },
      true,
    );
    const maintenanceName = `registry-gc-${randomUUID()}`;
    await offlineCollection({
      stop: async () => {
        await mw(['container', 'stop', registry.id, ...project, '-q']);
        await waitFor(async () => service(await list(), 'registry').status === 'stopped', 'registry stop');
      },
      create: () =>
        mw([
          'container',
          'run',
          ...project,
          '--stack-id',
          registry.stackId,
          '--name',
          maintenanceName,
          '--volume',
          'registry-data:/var/lib/registry',
          '--entrypoint',
          '/bin/registry',
          '-q',
          `mittwald/registry@${registry.deployedState.imageDigest}`,
          'garbage-collect',
          '--quiet',
          '/etc/distribution/config.yml',
        ]),
      wait: async (id) =>
        waitFor(async () => {
          const collector = (await list()).find((item) => item.id === id);
          if (!collector) throw new Error('Garbage collector disappeared.');
          if (/terminated with exit code 0\b/i.test(collector.message || '')) return true;
          if (/terminated with exit code [1-9]/i.test(collector.message || ''))
            throw new Error('Registry garbage collection failed.');
          return false;
        }, 'registry garbage collection'),
      remove: async (id) => {
        // Recover by name if creation succeeded remotely but its response timed out.
        const collector = (await list()).find(
          (item) => item.id === id || item.serviceName === maintenanceName,
        );
        if (collector) {
          await mw(['container', 'delete', collector.id, ...project, '-f', '-q']);
          await waitFor(
            async () => !(await list()).some((item) => item.id === collector.id),
            'collector removal',
          );
        }
      },
      start: async () => {
        await mw(['container', 'start', registry.id, ...project, '-q']);
        await waitFor(async () => service(await list(), 'registry').status === 'running', 'registry restart');
        console.log('Waiting for the registry HTTPS endpoint after restart.');
        await waitFor(async () => {
          try {
            const response = await fetch(`https://${registryHost}/v2/`, {
              headers: registryAuth,
              redirect: 'error',
              signal: AbortSignal.timeout(15000),
            });
            if ([502, 503, 504].includes(response.status)) return false;
            if (!response.ok) throw new Error(`Registry readiness check failed (${response.status}).`);
            return true;
          } catch (error) {
            if (error instanceof TypeError || error.name === 'TimeoutError') return false;
            throw error;
          }
        }, 'registry HTTPS readiness');
      },
    });
    await verifyManifest('latest');
    for (const digest of digests) await verifyManifest(digest);
    if (!(await health(origin))) throw new Error('Post-maintenance web health check failed.');
    const report = await execute(
      process.execPath,
      ['scripts/mittwald-storage-report.mjs', '--publish-report'],
      {
        env: cliEnv,
        timeout: 180000,
        maxBuffer: 1024 * 1024,
      },
    );
    console.log(report.stdout.trim());
    console.log(
      'Deployment verified. Only latest and still-needed images retained; original data volumes untouched.',
    );
  } finally {
    try {
      const keys = JSON.parse(await mw(['user', 'ssh-key', 'list', '-o', 'json']));
      for (const key of keys.filter((item) => item.comment === keyName))
        await mw(['user', 'ssh-key', 'delete', key.sshKeyId, '-f', '-q']);
    } finally {
      await rm(identity, { force: true });
      await rm(`${identity}.pub`, { force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployMittwald().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
