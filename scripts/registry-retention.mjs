import { pathToFileURL } from 'node:url';

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function retentionPlan(tags, manifests, deployed) {
  if (!deployed.length || deployed.some((digest) => !digestPattern.test(digest)))
    throw new Error('Valid deployed image digests are required.');
  const protectedDigests = new Set();
  function protect(digest) {
    if (protectedDigests.has(digest)) return;
    const manifest = manifests.get(digest);
    if (!manifest) throw new Error(`Manifest missing: ${digest}`);
    protectedDigests.add(digest);
    for (const child of manifest.children) protect(child);
  }
  for (const digest of deployed) protect(digest);
  function containsDeployed(digest, visited = new Set()) {
    if (deployed.includes(digest)) return true;
    if (visited.has(digest)) return false;
    visited.add(digest);
    const manifest = manifests.get(digest);
    if (!manifest) throw new Error(`Manifest missing: ${digest}`);
    return manifest.children.some((child) => containsDeployed(child, visited));
  }
  for (const tag of tags) {
    if (containsDeployed(tag.digest)) protect(tag.digest);
  }
  const latest = tags.find((tag) => tag.name === 'latest');
  if (!latest) throw new Error('The latest tag is missing.');
  protect(latest.digest);
  return {
    keptTags: tags.filter((tag) => protectedDigests.has(tag.digest)).map((tag) => tag.name),
    remove: [...manifests.keys()].filter((digest) => !protectedDigests.has(digest)),
  };
}

export async function maintainRegistry(env = process.env, apply = false) {
  const { REGISTRY_URL, REGISTRY_USER, REGISTRY_PASSWORD, REGISTRY_DEPLOYED_DIGESTS } = env;
  if (!REGISTRY_URL || !REGISTRY_USER || !REGISTRY_PASSWORD || !REGISTRY_DEPLOYED_DIGESTS)
    throw new Error(
      'REGISTRY_URL, REGISTRY_USER, REGISTRY_PASSWORD and REGISTRY_DEPLOYED_DIGESTS are required.',
    );
  const base = new URL(REGISTRY_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/')
    throw new Error('REGISTRY_URL must be an HTTPS origin without credentials.');
  const deployed = REGISTRY_DEPLOYED_DIGESTS.split(',').map((value) => value.trim());
  const headers = {
    Authorization: `Basic ${Buffer.from(`${REGISTRY_USER}:${REGISTRY_PASSWORD}`).toString('base64')}`,
    Accept:
      'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
  };
  async function request(path, method = 'GET') {
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new Error('Registry pagination changed origin.');
    const response = await fetch(url, {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Registry ${method} failed (${response.status}) for ${url.pathname}`);
    return response;
  }
  const manifests = new Map();
  async function manifest(reference) {
    if (manifests.has(reference)) return reference;
    const response = await request(`/v2/notto/manifests/${encodeURIComponent(reference)}`);
    const digest = response.headers.get('docker-content-digest');
    if (!digest || !digestPattern.test(digest)) throw new Error('Registry returned an invalid digest.');
    if (manifests.has(digest)) return digest;
    const value = await response.json();
    const entry = { children: [] };
    manifests.set(digest, entry);
    if (Array.isArray(value.manifests)) {
      for (const child of value.manifests) {
        if (!digestPattern.test(child.digest)) throw new Error('Invalid child digest.');
        entry.children.push(await manifest(child.digest));
      }
    } else {
      if (!digestPattern.test(value.config?.digest)) throw new Error('Manifest has no valid image config.');
    }
    return digest;
  }
  const names = [];
  let next = '/v2/notto/tags/list?n=100';
  const visited = new Set();
  while (next) {
    if (visited.has(next)) throw new Error('Registry pagination loop.');
    visited.add(next);
    const response = await request(next);
    const page = await response.json();
    names.push(...(page.tags || []));
    const link = response.headers.get('link');
    if (link && !/^<[^>]+>;\s*rel="next"$/.test(link)) throw new Error('Unsupported pagination link.');
    next = link?.match(/^<([^>]+)>/)?.[1] || '';
  }
  const tags = [];
  for (const name of new Set(names)) {
    const digest = await manifest(name);
    tags.push({ name, digest });
  }
  for (const digest of deployed) await manifest(digest);
  const plan = retentionPlan(tags, manifests, deployed);
  console.log(
    JSON.stringify(
      { apply, tagsBefore: tags.length, keptTags: plan.keptTags, manifestsToRemove: plan.remove.length },
      null,
      2,
    ),
  );
  if (apply) {
    for (const digest of plan.remove) await request(`/v2/notto/manifests/${digest}`, 'DELETE');
    console.log('Obsolete manifests deleted. Run offline registry garbage collection to reclaim blobs.');
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  maintainRegistry(process.env, process.argv.includes('--apply')).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
