import { normalizeHostname } from './vendorIntake.js';

export function normalizeEvidenceUrl(url: string, allowedDomains: string[]) {
  try {
    const parsed = new URL(url);

    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((key) =>
      parsed.searchParams.delete(key)
    );

    if (!isAllowedVendorHostname(parsed.hostname, allowedDomains)) {
      return '';
    }

    const normalized = `${parsed.origin}${parsed.pathname}${parsed.search ? parsed.search : ''}`.replace(
      /\/$/,
      ''
    );

    return normalized;
  } catch {
    return '';
  }
}

export function isAllowedVendorHostname(hostname: string, allowedDomains: string[]) {
  const normalizedHostname = normalizeHostname(hostname);

  if (!normalizedHostname) {
    return false;
  }

  return allowedDomains.some(
    (domain) => normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)
  );
}
