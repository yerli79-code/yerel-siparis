export const REDACTED = "[REDACTED]";

function isCredentialName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/_/g, "-");
  // These values describe the CORS contract; they do not contain credentials.
  if (/^access-control-(?:allow-(?:origin|methods|headers|credentials|private-network)|request-(?:method|headers|private-network)|expose-headers|max-age)$/.test(normalized)) return false;
  const camelCase = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/_/g, "-");
  return [normalized, camelCase].some(candidate =>
    /(?:^|-)(?:authorization|authentication|auth|apikey|api-key|cookie|cookies|password|secret|token|credentials?|session)(?:-|$)/.test(candidate) ||
    /(?:^|-)(?:authentication-info|www-authenticate|protection-bypass|service-role-key)(?:-|$)/.test(candidate));
}

export function redactNetworkHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name,
    isCredentialName(name) ? REDACTED : value,
  ]));
}

function redactEvidenceValue(value: unknown): unknown {
  if (typeof value === "string") return redactEvidenceText(value);
  if (Array.isArray(value)) return value.map(redactEvidenceValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const credentialHeader = typeof record.name === "string" && isCredentialName(record.name);
    return Object.fromEntries(Object.entries(record).map(([name, child]) => [
      name,
      isCredentialName(name) || (credentialHeader && name === "value") ? REDACTED : redactEvidenceValue(child),
    ]));
  }
  return value;
}

export function stringifyRedactedEvidence(value: unknown, space?: number): string {
  return JSON.stringify(redactEvidenceValue(value), null, space) ?? "null";
}

export function redactEvidenceText(text: string): string {
  // Console arguments can include a serialized header map or HAR-style headers.
  if (/^[\s]*[\[{]/.test(text)) {
    try { return stringifyRedactedEvidence(JSON.parse(text)); } catch { /* Fall back to text redaction. */ }
  }
  return text
    .replace(/((['"]?)(?:set[-_]cookie|cookie)\2\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]+)/gi,
      (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(/(['"]?)([a-z0-9_-]*(?:authorization|apikey|api[-_]key|password|secret|token|credential|authentication[-_]info|protection[-_]bypass)[a-z0-9_-]*)\1(\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,}]+)/gi,
      (match, quote: string, name: string, separator: string, value: string) => {
        if (!isCredentialName(name)) return match;
        const valueQuote = value.startsWith('"') || value.startsWith("'") ? value[0] : "";
        return `${quote}${name}${quote}${separator}${valueQuote}${REDACTED}${valueQuote}`;
      })
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;'"}\]]+/gi, REDACTED)
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, REDACTED);
}
