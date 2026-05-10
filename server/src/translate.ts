// Refinement + ko/en/ja translation via gpt-realtime-2 (text mode).
//
// We deliberately keep this layer separate from the streaming STT path. The
// realtime relay calls translate() once per "final" transcript segment and
// writes the result back into RTDB, leaving the original/translating row
// in place so the audience UI never blanks out.

import OpenAI from "openai"
import { sanitize } from "./filters.js"

export interface PersonaConfig {
    enabled: boolean
    basePromptKo?: string
    basePromptEn?: string
    basePromptJa?: string
    basePromptZh?: string
    customInstructions?: string
    medicalTerms?: string
}

export interface TranslateInput {
    rawText: string
    sourceLang: string
    sessionContext: string
    previousRefined: string
    targetLanguages: readonly string[]
    persona: PersonaConfig | null
}

export interface TranslateResult {
    refined: string
    isMedical: boolean
    translations: Record<string, string>
    ms: number
    model: string
}

const LANG_NAME: Record<string, string> = {
    ko: "Korean",
    en: "English",
    ja: "Japanese",
    zh: "Chinese",
}

const SYSTEM_PROMPT =
    "You refine live medical speech-to-text output and produce translations in strict JSON. Do not hallucinate or create fake text."

function buildPersonaBlock(persona: PersonaConfig | null): string {
    if (!persona || !persona.enabled) return ""
    const lines: string[] = []
    if (persona.customInstructions) lines.push(`Instructions: ${persona.customInstructions}`)
    if (persona.medicalTerms) lines.push(`Medical Dictionary: ${persona.medicalTerms}`)
    if (lines.length === 0) return ""
    return "\n[Persona Context]\n" + lines.join("\n")
}

function buildPrompt(input: TranslateInput): string {
    const { rawText, sourceLang, sessionContext, previousRefined, targetLanguages, persona } = input
    const targetsLine = targetLanguages.map((l) => `${l}=${LANG_NAME[l] || l}`).join(", ")
    const langFields = targetLanguages.map((l) => `"${l}": ""`).join(", ")
    const contextLine = sanitize(sessionContext).slice(0, 180)
    const previousLine = sanitize(previousRefined).slice(0, 80)

    return [
        `source_lang=${sourceLang}`,
        `targets=${targetsLine}`,
        `input=${rawText}`,
        contextLine ? `session_context=${contextLine}` : "",
        previousLine ? `previous_refined=${previousLine}` : "",
        buildPersonaBlock(persona),
        `Return strict JSON: {"refined":"","isMedical":true, ${langFields}}.`,
        'Rules: (1) Output ONLY what is in "input" — never add, expand, or infer content from session_context or previous_refined. (2) Correct only obvious STT errors (e.g. wrong homophone). (3) Translate "input" into EVERY target language field. (4) Never leave any target language field empty; translate fragments as fragments. (5) Keep all clinical terminology literal. (6) DO NOT generate conversational filler, meta-text, or hallucinations. (7) If input is just a meta-tag hallucination like "新しい話者、所属、新しいトピック" or "新しい話題", return empty strings.',
        `If source_lang matches a target language, the text for that language must remain in the source language.`,
    ]
        .filter(Boolean)
        .join("\n")
}

function validate(
    parsed: Record<string, unknown>,
    targetLanguages: readonly string[],
    sourceLang: string,
): boolean {
    if (!parsed) return false
    for (const lang of targetLanguages) {
        if (lang === sourceLang) continue
        const value = parsed[lang]
        if (!value || String(value).trim().length === 0) return false
    }
    return true
}

function buildResult(
    parsed: Record<string, unknown>,
    sourceLang: string,
    rawText: string,
    targetLanguages: readonly string[],
    model: string,
    ms: number,
): TranslateResult {
    const refined = sanitize((parsed.refined as string) || rawText)
    const translations: Record<string, string> = {}

    for (const lang of targetLanguages) {
        if (lang === sourceLang) {
            translations[lang] = refined
        } else if (parsed[lang]) {
            translations[lang] = sanitize(parsed[lang] as string)
        } else {
            translations[lang] = ""
        }
    }

    return {
        refined,
        isMedical: (parsed.isMedical as boolean) ?? false,
        translations,
        ms,
        model,
    }
}

type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"

function parseReasoningEffort(raw: string | undefined): ReasoningEffort | undefined {
    if (!raw) return undefined
    const v = raw.toLowerCase()
    if (v === "minimal" || v === "low" || v === "medium" || v === "high" || v === "xhigh") {
        return v
    }
    return undefined
}

// The translation step does NOT need a reasoning model — gpt-4o-mini has
// been working well for refinement + ko/en/ja JSON output in production.
// The real upgrade in this branch is the STT side (gpt-realtime-whisper).
// Override via OPENAI_REASONING_MODEL only when you want to experiment
// (e.g. "gpt-4o" for slightly better disambiguation, "gpt-realtime-2"
// with OPENAI_REASONING_EFFORT for GPT-5-class reasoning).
const DEFAULT_TRANSLATION_MODEL = "gpt-4o-mini"

// Detect whether a given model id is a reasoning model that accepts the
// `reasoning_effort` parameter. Non-reasoning models reject it.
function isReasoningModel(model: string): boolean {
    return /^(o\d|gpt-realtime-2|gpt-5)/i.test(model)
}

export class Translator {
    private openai: OpenAI
    private readonly model: string
    private readonly reasoningEffort: ReasoningEffort | undefined

    constructor(openai: OpenAI, model = DEFAULT_TRANSLATION_MODEL) {
        this.openai = openai
        this.model = model
        this.reasoningEffort = parseReasoningEffort(process.env.OPENAI_REASONING_EFFORT)
    }

    async translate(input: TranslateInput): Promise<TranslateResult | null> {
        const { rawText, sourceLang, targetLanguages } = input
        if (!rawText || rawText.trim().length === 0) return null

        const tStart = Date.now()
        const prompt = buildPrompt(input)

        const completion = await this.openai.chat.completions.create({
            model: this.model,
            // Only attach reasoning_effort when the model actually supports it.
            // Non-reasoning models like gpt-4o-mini reject unknown parameters.
            ...(isReasoningModel(this.model) && this.reasoningEffort
                ? { reasoning_effort: this.reasoningEffort }
                : {}),
            temperature: 0,
            max_tokens: 1000,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: prompt },
            ],
        })

        const content = completion.choices[0]?.message?.content || ""
        if (!content) return null

        let parsed: Record<string, unknown>
        try {
            parsed = JSON.parse(content) as Record<string, unknown>
        } catch {
            return null
        }

        // Repair pass for any missing target fields.
        const missing = targetLanguages.filter(
            (t) => t !== sourceLang && (!parsed[t] || String(parsed[t]).trim().length === 0),
        )
        if (missing.length > 0) {
            const repairFields = missing.map((l) => `"${l}": ""`).join(", ")
            const repairTargets = missing.map((l) => `${l}=${LANG_NAME[l] || l}`).join(", ")
            const repairPrompt = [
                `source_lang=${sourceLang}`,
                `targets=${repairTargets}`,
                `input=${rawText}`,
                `Return strict JSON: {${repairFields}}.`,
                'Rules: (1) Translate "input" into EVERY target language field. (2) Never leave any field empty.',
            ].join("\n")

            try {
                const repair = await this.openai.chat.completions.create({
                    model: this.model,
                    temperature: 0,
                    max_tokens: 800,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content:
                                "You translate text into requested target languages and output strict JSON only.",
                        },
                        { role: "user", content: repairPrompt },
                    ],
                })
                const repairContent = repair.choices[0]?.message?.content || ""
                if (repairContent) {
                    const repairData = JSON.parse(repairContent) as Record<string, unknown>
                    for (const lang of missing) {
                        const v = repairData[lang]
                        if (v && String(v).trim().length > 0) parsed[lang] = v
                    }
                }
            } catch {
                // best effort — fall through to validation below
            }
        }

        if (!validate(parsed, targetLanguages, sourceLang)) return null

        return buildResult(
            parsed,
            sourceLang,
            rawText,
            targetLanguages,
            this.model,
            Date.now() - tStart,
        )
    }
}
