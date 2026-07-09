interface ExtractedJsonStringField {
  value: string;
  complete: boolean;
}

const isEscaped = (text: string, index: number) => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const findStringFieldStart = (text: string, fieldName: string) => {
  const fieldToken = `"${fieldName}"`;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const fieldIndex = text.indexOf(fieldToken, searchFrom);
    if (fieldIndex === -1) return -1;
    if (isEscaped(text, fieldIndex)) {
      searchFrom = fieldIndex + fieldToken.length;
      continue;
    }

    let cursor = fieldIndex + fieldToken.length;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (text[cursor] !== ':') {
      searchFrom = fieldIndex + fieldToken.length;
      continue;
    }

    cursor += 1;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (text[cursor] === '"') return cursor + 1;

    searchFrom = fieldIndex + fieldToken.length;
  }

  return -1;
};

export const extractJsonStringField = (text: string, fieldName: string): ExtractedJsonStringField | null => {
  const start = findStringFieldStart(text, fieldName);
  if (start === -1) return null;

  let value = '';
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === '"') {
      return { value, complete: true };
    }

    if (char !== '\\') {
      value += char;
      continue;
    }

    if (cursor + 1 >= text.length) return { value, complete: false };

    const escaped = text[cursor + 1];
    if (escaped === 'u') {
      const hex = text.slice(cursor + 2, cursor + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        return { value, complete: false };
      }
      value += String.fromCharCode(parseInt(hex, 16));
      cursor += 5;
      continue;
    }

    const escapeMap: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    value += escapeMap[escaped] ?? escaped;
    cursor += 1;
  }

  return { value, complete: false };
};

