const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "ftp:", "sftp:"]);

export function isProtocolAllowed(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
