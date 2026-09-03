function normalizedText(value) {
  return String(value || "").normalize("NFKC").replace(/[\u00ad\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

function isChineseTarget(targetLanguage) {
  return /(?:中文|汉语|简体|繁体|chinese)/i.test(String(targetLanguage || ""));
}

function looksLikeBibliography(text) {
  const numbered = text.match(/(?:^|\s)\[?\d{1,3}\]?[.)、]\s+/g) || [];
  const identifiers = text.match(/(?:https?:\/\/|doi\s*:|10\.\d{4,9}\/)/gi) || [];
  return /^(?:references?|参考文献)\b/i.test(text) || numbered.length >= 2 || identifiers.length >= 2;
}

function looksLikeMetadata(text) {
  if (/^(?:https?:\/\/|www\.|doi\s*:)/i.test(text)) return true;
  if (text.length < 70) return true;
  if (/(?:downloaded\s+(?:by|on|from)|terms-and-conditions|wiley\s+online\s+library|creative\s+commons|all\s+rights\s+reserved|open\s+access\s+article|contributed\s+equally|corresponding\s+author|orcid)/i.test(text)) return true;
  if ((text.match(/@/g) || []).length >= 1 && /(?:university|institute|laboratory|academy|department)/i.test(text)) return true;
  const affiliations = text.match(/(?:university|institute|laboratory|academy|department|school\s+of|college\s+of|research\s+center)/gi) || [];
  if (affiliations.length >= 2) return true;
  return looksLikeBibliography(text);
}

export function isSourcePreservingContent(sourceValue, context = {}) {
  const text = normalizedText(sourceValue);
  const role = String(context?.role || "");
  if (!text || role === "figure-caption") return false;
  if (looksLikeBibliography(text)) return true;
  if (/^(?:https?:\/\/|www\.|doi\s*:|10\.\d{4,9}\/)/i.test(text)) return true;
  if (/(?:correspondence|corresponding\s+author|e-?mail|orcid)\s*:?/i.test(text) && /(?:@|https?:\/\/|orcid)/i.test(text)) return true;
  if (/(?:downloaded\s+(?:by|on|from)|terms-and-conditions|wiley\s+online\s+library|creative\s+commons|all\s+rights\s+reserved|open\s+access\s+article)/i.test(text)) return true;
  if (role === "metadata" && text.length <= 180 && /@|(?:university|institute|laboratory|academy|department)\b/i.test(text)) return true;
  return false;
}

function englishWordSet(value) {
  return new Set((value.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || []).filter(word => word.length > 2));
}

function sourceLooksLikeEnglishProse(text) {
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const words = text.match(/[A-Za-z][A-Za-z'-]{1,}/g) || [];
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return text.length >= 70 && latin >= 45 && words.length >= 8 && han < Math.max(4, latin * 0.08) && !looksLikeMetadata(text);
}

function sourceSimilarity(source, translation) {
  const sourceWords = englishWordSet(source), translatedWords = englishWordSet(translation);
  if (sourceWords.size < 8 || translatedWords.size < 8) return 0;
  let shared = 0;
  for (const word of sourceWords) if (translatedWords.has(word)) shared += 1;
  // Scientific Chinese legitimately preserves a small subset of English terms,
  // acronyms and chemical names. Measure source coverage instead of asking whether
  // every retained English token also appeared in the source.
  return shared / Math.max(1, sourceWords.size);
}

export function translationQuality(sourceValue, translationValue, targetLanguage = "简体中文", context = {}) {
  const source = normalizedText(sourceValue), translation = normalizedText(translationValue);
  if (!translation) return { valid: false, reason: "empty" };
  // Short publisher/author metadata may legitimately remain mostly Latin text.
  // Figure captions still need the same target-language validation as body text.
  if (String(context?.role || "") === "metadata") return { valid: true, reason: "metadata" };
  if (isSourcePreservingContent(source, context)) return { valid: true, reason: "source-preserving" };
  if (!isChineseTarget(targetLanguage) || !sourceLooksLikeEnglishProse(source)) return { valid: true, reason: "not-applicable" };

  const han = (translation.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (translation.match(/[A-Za-z]/g) || []).length;
  const englishWords = translation.match(/[A-Za-z][A-Za-z'-]{1,}/g) || [];
  const compactSource = source.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const compactTranslation = translation.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const shorter = Math.min(compactSource.length, compactTranslation.length);
  const nearCopy = shorter >= 55 && (
    compactSource === compactTranslation
    || (compactSource.includes(compactTranslation) && compactTranslation.length / compactSource.length >= 0.72)
    || (compactTranslation.includes(compactSource) && compactSource.length / compactTranslation.length >= 0.72)
    || sourceSimilarity(source, translation) >= 0.84
  );
  const mostlyEnglish = han < 6 && latin >= 35 && englishWords.length >= 7 && latin / Math.max(1, latin + han) >= 0.86;
  if (nearCopy) return { valid: false, reason: "source-copy" };
  if (mostlyEnglish) return { valid: false, reason: "target-language-missing" };
  return { valid: true, reason: "ok" };
}

export function isLikelyUntranslated(source, translation, targetLanguage = "简体中文", context = {}) {
  return !translationQuality(source, translation, targetLanguage, context).valid;
}
