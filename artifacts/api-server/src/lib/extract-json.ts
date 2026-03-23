function findJsonBlock(text: string, openChar: string, closeChar: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"' && depth > 0) {
      inString = true;
      continue;
    }

    if (ch === openChar) {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === closeChar) {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

export function extractJSON<T = unknown>(rawText: string): T {
  const cleaned = rawText
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
  }

  const objectBlock = findJsonBlock(cleaned, "{", "}");
  if (objectBlock) {
    try {
      return JSON.parse(objectBlock) as T;
    } catch {
    }
  }

  const arrayBlock = findJsonBlock(cleaned, "[", "]");
  if (arrayBlock) {
    try {
      return JSON.parse(arrayBlock) as T;
    } catch {
    }
  }

  throw new Error(`Could not parse JSON from text: ${cleaned.slice(0, 200)}`);
}
