// Hallucination & garbage filters — extracted from functions/src/stt.ts so the
// realtime relay and the legacy chunked HTTP path share the exact same rules.
//
// Keep this module pure (no I/O, no env reads) so it can be unit-tested in
// isolation and imported by both the Cloud Function bundle and the Express
// relay.

const URL_FILTER_REGEX =
    /(?:https?:\/\/)?(?:www\.)?(?:sites\.google\.com|cst\.eu\.com|Amara\.org|amara\.org|youtube\.com|youtu\.be)\S*/gi

const META_FILTER_REGEX =
    /(?:Thank you for watching\.?|Thanks for watching\.?|Thank you\.?|시청해 주셔서 감사합니다\.?|시청해주셔서 감사합니다\.?|ご視聴ありがとうございました\.?|ご視聴いただきありがとうございました\.?|チャンネル登録お願いします\.?|字幕提供|サブタイトル|MBC 뉴스|SBS 뉴스|KBS 뉴스|YTN 뉴스|JTBC 뉴스|연합뉴스|新しい話者、所属、新しいトピック|新しい話題|유료광고|유료 광고|paid advertisement|disclaimer|면책 조항|면책조항|영상편집 및 자막|자막 제공 및 광고|광고를 포함하고|알 수 없는 소리|\[Music\]|\(Music\)|\[music\]|\(music\)|\[Applause\]|\(Applause\)|\[applause\]|\(applause\)|\[Laughter\]|\(Laughter\)|\[laughter\]|\(laughter\)|\(박수\)|\[박수\]|\(웃음\)|\[웃음\]|\(환호\)|\[환호\]|\(음악\)|\[음악\]|\(노래\)|\[노래\]|\(소음\)|\[소음\]|\(침묵\)|\[침묵\]|\(무음\)|\[무음\])/gi

export function sanitize(s: string): string {
    let t = (s || "").toString()
    t = t.replace(/[`]{3,}/g, "").replace(/[`]/g, "")
    t = t.replace(/\bundefined\b/gi, "")
    t = t.replace(URL_FILTER_REGEX, " ")
    t = t.replace(META_FILTER_REGEX, " ")
    return t.replace(/\s+/g, " ").trim()
}

export function hasRepetitionLoop(text: string): boolean {
    const tokens =
        text.match(
            /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu,
        ) || []
    const words = tokens.slice(0, 40)

    if (words.length < 8) return false

    const unique = new Set(words.map((w) => w.toLowerCase()))
    return (
        unique.size <= 6 &&
        (text.length > 80 ||
            (text.length > 20 && tokens.length === text.replace(/\s/g, "").length))
    )
}

function normalizeLoose(text: string): string {
    return (text || "").toLowerCase().replace(/[()]/g, " ").replace(/\s+/g, " ").trim()
}

export function isPromptLeakage(text: string, promptText?: string): boolean {
    if (!text || !promptText) return false

    const normalizedText = normalizeLoose(text)
    const normalizedPrompt = normalizeLoose(promptText)
    if (!normalizedText || !normalizedPrompt) return false

    if (normalizedText.includes(normalizedPrompt) && normalizedPrompt.length >= 10) return true
    if (normalizedPrompt.includes(normalizedText) && normalizedText.length >= 40) return true

    const promptItems = promptText
        .split(",")
        .map((item) => normalizeLoose(item))
        .filter((item) => item.length >= 2)

    if (promptItems.length < 3) return false

    const matchedItems = promptItems.filter((item) => normalizedText.includes(item))
    const commaCount = (text.match(/,/g) || []).length
    if (matchedItems.length >= 3 && commaCount >= 2) return true
    if (matchedItems.length >= 3 && text.length < 50) return true

    return false
}

export function isGarbage(text: string, _originalText?: string, promptText?: string): boolean {
    if (!text) return false
    if (hasRepetitionLoop(text)) return true
    if (isPromptLeakage(text, promptText)) return true

    if (/^\s*[\(\[][^\)\]]{1,40}[\)\]]\s*[\.!]?\s*$/.test(text.trim())) return true

    const filterGarbage =
        /(Transcribe exactly|발화 내용만 정확히|구독과 좋아요|알림.*설정|Please subscribe|Thank you for|Thanks for watching|시청.*감사|^감사합니다\.?$|영상편집|자막 제공|광고를 포함|알 수 없는 소리|subtitles by|subtitle by|자막.*제작|번역.*제공|MBC 뉴스|SBS 뉴스|KBS 뉴스|ご視聴|チャンネル登録|新しい話者、所属、新しいトピック|新しい話題|字幕提供)/i
    if (filterGarbage.test(text.trim()) && text.length < 150) return true

    const alphanumeric = text.replace(/[^\p{L}\p{N}]/gu, "")
    if (alphanumeric.length < 2) return true

    if (
        text.includes("新しい話者") ||
        text.includes("新しいトピック") ||
        text.includes("新しい話題")
    ) {
        return true
    }

    return false
}
