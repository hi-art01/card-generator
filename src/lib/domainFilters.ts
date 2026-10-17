const BANNED_HOSTS = new Set(['debatearguments.substack.com']);
const BANNED_HOST_SUFFIXES = ['wikipedia.org'];

function normalizeHostname(value: string): string | null {
  try {
    const parsedUrl = new URL(value.startsWith('http') ? value : `https://${value}`);
    return parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isBannedUrl(url: string): boolean {
  const hostname = normalizeHostname(url);
  return hostname
    ? BANNED_HOSTS.has(hostname) ||
        BANNED_HOST_SUFFIXES.some(
          (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
        )
    : false;
}

export function getBannedUrlMessage(url: string): string {
  const hostname = normalizeHostname(url) ?? url;
  return `Sources from ${hostname} are blocked and cannot be used for card generation.`;
}
