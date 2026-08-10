const ALL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const CONTROL_CHARACTERS_EXCEPT_NEWLINE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

export type SanitizePrintTextOptions = {
  allowNewlines?: boolean;
};

/**
 * Removes transport/printer control characters without changing printable
 * Unicode. Multiline receipt fields may retain LF; tabs and every other C0/C1
 * character (including NUL, ESC, and GS) are always removed.
 */
export function sanitizePrintText(
  value: string,
  options: SanitizePrintTextOptions = {},
) {
  const normalized = options.allowNewlines
    ? value.replace(/\r\n?/g, "\n")
    : value;
  const pattern = options.allowNewlines
    ? CONTROL_CHARACTERS_EXCEPT_NEWLINE
    : ALL_CONTROL_CHARACTERS;

  return normalized.replace(pattern, "").trim();
}

export function hasUnsafePrintControlCharacters(
  value: string,
  options: SanitizePrintTextOptions = {},
) {
  const pattern = options.allowNewlines
    ? CONTROL_CHARACTERS_EXCEPT_NEWLINE
    : ALL_CONTROL_CHARACTERS;
  pattern.lastIndex = 0;
  return pattern.test(value);
}
