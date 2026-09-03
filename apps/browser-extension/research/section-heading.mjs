import { isReferenceEntryStart } from "./reference-list.mjs";

const SECTION_TOKEN = "(?:S\\d+[a-z]?\\.?|\\d+(?:\\.\\d+)+\\.?|\\d+\\.)";

function matchSourceSection(text) {
  return String(text || "").trim().match(new RegExp(`^(${SECTION_TOKEN})\\s+(.{2,120}?)(?:\\.\\s+|:\\s+)([\\s\\S]+)$`, "i"));
}

function matchTranslatedSection(text) {
  return String(text || "").trim().match(new RegExp(`^(${SECTION_TOKEN})\\s*(.{1,80}?)(?:[。；;：:]|\\.(?:\\s+|$))\\s*([\\s\\S]+)$`, "i"));
}

export function splitInlineSection(sourceText, translatedText) {
  const source = String(sourceText || "").trim();
  const translated = String(translatedText || "").trim();
  if (isReferenceEntryStart(source) || isReferenceEntryStart(translated)) return null;
  const sourceMatch = matchSourceSection(source);
  const translatedMatch = matchTranslatedSection(translated);
  if (!sourceMatch || !translatedMatch || !sourceMatch[3].trim() || !translatedMatch[3].trim()) return null;

  const sourceBodyStart = source.indexOf(sourceMatch[3]);
  if (sourceBodyStart <= 0) return null;
  return {
    heading: `${translatedMatch[1]} ${translatedMatch[2]}`.replace(/\s+/g, " ").trim(),
    body: translatedMatch[3].trim(),
    sourceHeadingStart: 0,
    sourceHeadingEnd: sourceBodyStart,
    sourceBodyStart,
    sourceBodyEnd: source.length
  };
}
