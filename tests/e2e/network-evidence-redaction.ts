export const REDACTED = "[REDACTED]";

function credentialNameVariants(name: string): string[] {
  // Query keys can encode separators; keep their classification identical to headers.
  try { name = decodeURIComponent(name); } catch { /* Keep malformed names literal. */ }
  const normalized = name.toLowerCase().replace(/_/g, "-");
  const camelCase = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/_/g, "-");
  return [normalized, camelCase];
}

function isCredentialName(name: string): boolean {
  const variants = credentialNameVariants(name);
  // These values describe the CORS contract; they do not contain credentials.
  if (variants.some(candidate => /^access-control-(?:allow-(?:origin|methods|headers|credentials|private-network)|request-(?:method|headers|private-network)|expose-headers|max-age)$/.test(candidate))) return false;
  return variants.some(candidate =>
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

function structuredValueLength(text: string): number {
  const stack: string[] = [];
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      if (stack.pop() !== (char === "}" ? "{" : "[")) return text.length;
      if (!stack.length) return index + 1;
    }
  }
  // An unfinished sensitive value may contain credentials anywhere in its tail.
  return text.length;
}

export function redactEvidenceText(text: string): string {
  // Console arguments can include a serialized header map or HAR-style headers.
  if (/^[\s]*[\[{]/.test(text)) {
    try { return stringifyRedactedEvidence(JSON.parse(text)); } catch { /* Fall back to text redaction. */ }
  }
  let safe = "";
  let cursor = 0;
  // Scan prefixes only: a benign message/url assignment must not consume a
  // nested credential assignment or query key before it can be classified.
  for (const match of text.matchAll(/(?<![a-z0-9_%-])(['"]?)([a-z0-9_%-]+)\1(\s*[:=]\s*)/gi)) {
    if (match.index < cursor) continue;
    const valueStart = match.index + match[0].length;
    const tail = text.slice(valueStart);
    const inQuery = /https?:\/\/[^\s'"<>#]*[?&]$/i.test(text.slice(0, match.index));
    const quoted = inQuery ? undefined : /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/.exec(tail)?.[0];
    if (!isCredentialName(match[2])) {
      // A benign message field can hold an escaped JSON string. Decode only
      // complete quoted strings and preserve unchanged values byte for byte.
      if (quoted) {
        try {
          const decoded = quoted[0] === '"' ? JSON.parse(quoted) as string : quoted.slice(1, -1).replace(/\\(['"\\])/g, "$1");
          const redacted = redactEvidenceText(decoded);
          if (redacted !== decoded) {
            const encoded = quoted[0] === '"' ? JSON.stringify(redacted) : `'${redacted.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
            safe += text.slice(cursor, valueStart) + encoded;
            cursor = valueStart + quoted.length;
          }
        } catch { /* Keep malformed benign values available to the prefix scan. */ }
      }
      continue;
    }
    // Cookie attributes and authentication challenges can contain further
    // assignments and commas; redact their whole unquoted value.
    const wholeHeaderValue = credentialNameVariants(match[2]).some(candidate =>
      /(?:^|-)(?:cookies?|www-authenticate|authentication-info)(?:-|$)/.test(candidate));
    const value = inQuery ? /^[^&#\s<>]*/.exec(tail)?.[0] ?? ""
      : quoted ?? (/^['"]/.test(tail) ? tail
        : /^[{\[]/.test(tail) ? tail.slice(0, structuredValueLength(tail))
          : wholeHeaderValue ? /^[^\r\n]*/.exec(tail)?.[0] ?? ""
            : /^[^\r\n'"]*?(?=(?:\s+|[,;]\s*)['"]?[a-z0-9_%-]+['"]?\s*[:=]|[\r\n'"]|$)/i.exec(tail)?.[0] ?? "");
    const quote = quoted ? quoted[0] : "";
    safe += text.slice(cursor, valueStart) + `${quote}${REDACTED}${quote}`;
    cursor = valueStart + value.length;
  }
  return (safe + text.slice(cursor))
    .replace(/\b(?:Bearer|Basic)\s+(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;'"}\]&#]+)/gi, REDACTED)
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, REDACTED);
}
