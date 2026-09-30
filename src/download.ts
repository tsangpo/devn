import { validateProfile, type Profile } from './registry';
import { secureURL } from './urls';

export class Unavailable extends Error {}
export const MAX_PROFILE_BYTES = 1024 * 1024;

export async function downloadProfile(source: string, id: string): Promise<Profile> {
  let url = secureURL(source);
  const signal = AbortSignal.timeout(10000);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    try {
      response = await fetch(url, { signal, redirect: 'manual', headers: { Accept: 'application/json' } });
    } catch { throw new Unavailable('Profile server is unavailable or timed out.'); }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 5) throw new Error('Invalid or excessive profile redirects.');
    let next: URL;
    try { next = secureURL(new URL(location, url).href); }
    catch { throw new Error('Profile redirect points to an unsafe URL.'); }
    if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('HTTPS profile redirects cannot downgrade to HTTP.');
    url = next;
  }
  if (!response) throw new Unavailable('Profile server is unavailable.');
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status >= 500) throw new Unavailable(`Profile server returned HTTP ${response.status}.`);
    throw new Error(`Profile server returned HTTP ${response.status}; launch cancelled.`);
  }
  if (Number(response.headers.get('content-length')) > MAX_PROFILE_BYTES) {
    await response.body?.cancel();
    throw new Error('Profile exceeds the 1 MiB download limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Profile response is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await reader.read(); }
      catch { throw new Unavailable('Profile download failed or timed out.'); }
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_PROFILE_BYTES) throw new Error('Profile exceeds the 1 MiB download limit.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let value: unknown;
  try { value = JSON.parse(await new Blob(chunks).text()); }
  catch { throw new Error('Profile server returned invalid JSON.'); }
  let profile: Profile;
  try { profile = validateProfile(value, id); }
  catch { throw new Error('Profile server returned an invalid profile definition.'); }
  if (profile.example) throw new Error('The example profile cannot connect. Publish a real profile first.');
  return profile;
}
