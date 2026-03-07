// Version: v7.9 (Language Locking)
import * as functions from "firebase-functions/v1"
import * as admin from "firebase-admin"
import OpenAI from "openai"
import type { Request } from "express"
import { Readable } from "stream"

let _openai: OpenAI | null = null
const getGeminiKeys = (): string[] => {
    const keys: string[] = [];
    const primaryKey = process.env.GEMINI_API_KEY || (functions.config()?.gemini?.key as string) || "";
    if (primaryKey) keys.push(primaryKey);
    keys.push("AIzaSyAYO3OAfzPxa1kZGyPGOoJIbiRewaumVI8"); // Fallback key supplied by user

    if (keys.length === 0) functions.logger.warn("GEMINI_API_KEY is not set.");
    return keys;
};
const GEMINI_FLASH_URL = (key: string) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`
const GEMINI_PRO_URL = (key: string) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${key}`

const getDynamicPrompt = (sourceLang: string, sessionContext: string, previousContext: string) => {
    const base = `
Role: Live Captioner for Medical Conference
Rule 1: Always output valid JSON.
Rule 2: Refine the input text to be grammatically correct and professional.
Rule 3: Infer medical terms from phonetic errors (e.g. "Gamgon" -> "Recommendation").

[FRAGMENT HANDLING]
- Even if the input is a single word or a fragment (e.g., "Criteria, Prevention,"), YOU MUST TRANSLATE IT.
- Do not skip short segments.
- If the input Korean seems like a typo (e.g., "遺덉쑀遺" -> sounds like "遺꾨쪟"), fix the Korean mentally and translate the intended meaning (e.g., "Classification").

[STRICT LANGUAGE RULES]
- Source Language: ${sourceLang}
`;

    let instructions = "";
    if (sourceLang === 'ko') {
        instructions = `
- "refined": Refine the input in Korean.
- "en": Translate to English. DO NOT include Korean characters in this field.
- "ja": Translate to Japanese.
`;
    } else if (sourceLang === 'en') {
        instructions = `
- "refined": Refine the input in English.
- "en": Same as "refined".
- "ja": Translate to Japanese.
`;
    } else if (sourceLang === 'ja') {
        instructions = `
- "refined": Refine the input in Japanese.
- "en": Translate to English.
- "ja": Same as "refined".
`;
    } else if (sourceLang === 'zh') {
        instructions = `
- "refined": Refine the input in Chinese.
- "en": Translate to English.
- "ja": Translate to Japanese.
`;
    } else {
        instructions = `
- "refined": Refine the input.
- "en": Translate to English.
- "ja": Translate to Japanese.
`;
    }

    return `${base}${instructions}
Output JSON Format: {"isMedicalContext": true|false, "refined": "...", "en": "...", "ja": "..."}

[CONTEXT CONTINUITY - CRITICAL]
- The PREVIOUS CONTEXT below is what was just said before this fragment. Your output MUST flow naturally from it.
- If the INPUT seems like a continuation or fragment of the previous context, connect them seamlessly.
- Example: If previous context ends with "25踰??꾪뵆??? and input is "二쇰????쇱쬆??, the refined result should naturally continue the thought, NOT start a new sentence.
- Remove unnecessary line breaks. Output as a single continuous phrase or sentence.
- Do NOT repeat words that already appear in the PREVIOUS CONTEXT.

${sessionContext ? `[SESSION INFO]\n${sessionContext}` : ""}
${previousContext ? `[PREVIOUS CONTEXT - continue naturally from this]\n${previousContext}` : ""}
[INPUT TO REFINE]: `;
};

const callGeminiREST = async (text: string, previousContext: string, sessionContext: string, sourceLang: string): Promise<{ isMedicalContext?: boolean, refined?: string, en?: string, ja?: string }> => {
    const prompt = getDynamicPrompt(sourceLang, sessionContext, previousContext);

    type GeminiPayload = {
        contents: { parts: { text: string }[] }[];
        generationConfig: { responseMimeType: string };
    };
    const payload: GeminiPayload = { contents: [{ parts: [{ text: `${prompt}"${text}"` }] }], generationConfig: { responseMimeType: "application/json" } }
    const apiKeys = getGeminiKeys();

    let data = null;
    let lastStatus = 500;

    for (const apiKey of apiKeys) {
        let res = await fetch(GEMINI_FLASH_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        if (res.ok) {
            data = await res.json();
            break;
        }

        const errText = await res.text();
        functions.logger.warn("Gemini REST Flash error", { status: res.status, body: errText });
        lastStatus = res.status;

        if (res.status === 429) continue; // Rate limit hit, try next key

        res = await fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        if (res.ok) {
            data = await res.json();
            break;
        }

        lastStatus = res.status;
        if (res.status === 429) continue; // Try next key
    }

    if (!data) {
        throw new Error(`Gemini REST Error: ${lastStatus}`);
    }

    const outText = (((data || {}).candidates || [])[0] || {}).content?.parts?.[0]?.text || ""
    if (!outText) return { refined: "" };

    try {
        const cleanText = outText.replace(/```json\s*|```/g, "").trim()
        const obj = JSON.parse(cleanText)
        return { isMedicalContext: !!obj.isMedicalContext, refined: sanitize(obj.refined), en: sanitize(obj.en), ja: sanitize(obj.ja) }
    } catch {
        return { refined: sanitize(outText) }
    }
}

const getOpenAI = (): OpenAI => {
    if (!_openai) {
        const envKey = process.env.OPENAI_API_KEY || ""
        const apiKey = envKey || (functions.config()?.openai?.key as string) || ""
        if (!apiKey) throw new Error("OPENAI_API_KEY missing")
        _openai = new OpenAI({ apiKey })
    }
    return _openai
}


const DENTAL_PROMPT = "移섍낵, ?꾪뵆??? 蹂댁쿋, ?섏닠, ?곸븙?? 怨⑥씠?? ?쎌뒪泥? ?대쾭?몃㉫?? ?щ씪?? Implant, Surgery, Bone Graft, Fixture, Abutment, Crown"

const sanitize = (s: string): string => {
    let t = (s || "").toString();
    t = t.replace(/[`]{3,}/g, "").replace(/[`]/g, "");
    t = t.replace(/\bundefined\b/gi, "");
    return t.trim();
}

const HALLUCINATION_BLACKLIST = ['?먮쭑?쒖옉', '?먮쭑 ?쒖옉', 'Subtitles by', 'MBC ?댁뒪', 'Copyright', 'http', '.co.kr'];
const isLoopPattern = (text: string): boolean => {
    if (HALLUCINATION_BLACKLIST.some(b => text.includes(b))) return true;
    if (/(.+)\1{2,}/.test(text)) return true;
    if (/(.*,){4,}/.test(text)) return true;
    if (/^(Implant, Surgery|?꾪뵆??? 蹂댁쿋)/i.test(text)) return true;
    return false;
};

// 1. HTTP Trigger: Receive Audio -> STT (Language Locked) -> Save Raw
export const processAudio = functions
    .runWith({ timeoutSeconds: 60, memory: "512MB" })
    .https.onRequest(async (req, res) => {
        const versionTag = "v7.9_lang_lock"
        // CORS Handling
        const origin = req.headers.origin as string;
        const allowedOrigin = process.env.ALLOWED_ORIGIN || (functions.config()?.app?.allowed_origin as string) || "*";

        if (allowedOrigin === "*" || allowedOrigin === origin) {
            res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
        } else if (origin && (origin.endsWith(".web.app") || origin.endsWith(".firebaseapp.com") || origin.includes("localhost"))) {
            res.set("Access-Control-Allow-Origin", origin);
        } else {
            res.set("Access-Control-Allow-Origin", allowedOrigin);
        }

        res.set("Access-Control-Allow-Methods", "POST, OPTIONS")
        res.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if (req.method === "OPTIONS") { res.status(204).send(""); return; }

        try {
            if (!admin.apps.length) throw new Error("Admin not initialized")
            const auth = (req.headers.authorization || "").toString()
            if (!auth.startsWith("Bearer ")) { res.status(401).json({ success: false }); return; }

            const projectId = (req.query.projectId || "").toString()
            const sourceLabel = (req.query.sourceLabel || "").toString()
            if (!projectId) { res.status(400).json({ success: false }); return; }

            let buf: Buffer | null = null
            const raw = (req as Request & { rawBody?: Buffer }).rawBody as Buffer | undefined
            if (raw && Buffer.isBuffer(raw)) buf = raw
            else if (Buffer.isBuffer(req.body)) buf = req.body as Buffer
            else if (typeof req.body === "string") buf = Buffer.from(req.body, "binary")

            if (!buf || buf.length === 0) { res.status(400).json({ success: false }); return; }

            // Get Source Language
            let sourceLang = 'ko';
            let activeSessionId: string | null = null;
            try {
                const activeSnap = await admin.database().ref(`projects/${projectId}/activeSessionId`).get();
                activeSessionId = activeSnap.val();
                if (activeSessionId) {
                    const sessionSnap = await admin.database().ref(`projects/${projectId}/sessions/${activeSessionId}`).get();
                    if (sessionSnap.exists()) {
                        sourceLang = sessionSnap.val().sourceLanguage || 'ko';
                    }
                }
            } catch { // Intentionally empty
            }

            await admin.database().ref(`projects/${projectId}/status`).update({ lastActive: Date.now() }).catch(() => { })

            let openai: OpenAI
            try { openai = getOpenAI() } catch { res.status(500).json({ success: false }); return; }

            if (buf.length < 2000) { res.status(200).json({ success: false, error: "TooSmall" }); return; }

            let stt: { text?: string } | undefined
            try {
                const audioStream = Readable.from(buf) as Readable & { path: string };
                audioStream.path = "audio.webm"; // ?먮낯 ?щ㎎??webm?쇰줈 ?먮났

                stt = await openai.audio.transcriptions.create({
                    file: audioStream,
                    model: "whisper-1",
                    language: sourceLang,
                    prompt: DENTAL_PROMPT,
                    temperature: 0
                });
                functions.logger.info("Whisper Raw Result:", { text: stt?.text });
                await admin.database().ref(`projects/${projectId}/status/services/openai`).set({ state: "ok", ts: Date.now() }).catch(() => { });
            } catch (error: any) {
                functions.logger.error("Whisper API Error:", error.message);
                res.status(200).json({ success: false, error: "WhisperFailed", details: error.message });
                return;
            }

            const rawResponseText = stt?.text || "";
            let rawText = sanitize(rawResponseText.trim())

            if (rawText.length < 2) {
                functions.logger.info("Whisper result too short or empty, dropping", { raw: rawResponseText });
                rawText = "";
            }

            if (isLoopPattern(rawText)) { res.status(200).json({ success: true, info: "LoopDropped" }); return; }

            if (!rawText) { res.status(200).json({ success: true, info: "Empty" }); return; }

            const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            const timestamp = Date.now()

            // Sequence Logic
            const seqRef = admin.database().ref(`projects/${projectId}/lastSequence`);
            const seqResult = await seqRef.transaction((current) => {
                return (current || 0) + 1;
            });
            const seq = seqResult.snapshot.val();

            await admin.database().ref(`projects/${projectId}/stream/${id}`).set({
                original: rawText,
                status: "raw",
                timestamp,
                sourceLabel,
                sessionId: activeSessionId,
                seq
            })

            await admin.database().ref(`projects/${projectId}/state`).update({ lastText: rawText, lastId: id }).catch(() => { })

            res.status(200).json({ success: true, id, text: rawText, stage: "original", timestamp, version: versionTag })

        } catch (e: unknown) {
            void e;
            res.status(500).json({ success: false, error: "Internal Error" })
        }
    })

// 2. DB Trigger: Refine Text (Concurrency Safe & Dynamic Language)
export const onRefineRequest = functions
    .runWith({ timeoutSeconds: 60, memory: "512MB" })
    .database.ref("projects/{projectId}/stream/{dataId}")
    .onCreate(async (snapshot, context) => {
        const { projectId, dataId } = context.params;
        const val = snapshot.val();

        if (!val || val.status !== 'raw') return;
        const rawText = val.original;

        const projectRef = admin.database().ref(`projects/${projectId}`);
        let bufferText = "";
        let bufferIds: string[] = [];
        let lastGeminiTime = 0;
        let sessionContext = "";
        let sourceLang = "ko";
        let chunkSettings = { minLength: 80, timeoutMs: 5000, sentenceEnd: true }; // Default (optimized for context coherence)

        let activeSessionId: string | null = null;
        try {
            const [stateSnap, activeSnap, settingsSnap] = await Promise.all([
                projectRef.child('state').get(),
                projectRef.child('activeSessionId').get(),
                projectRef.child('settings/chunk').get()
            ]);

            if (stateSnap.exists()) {
                const st = stateSnap.val();
                bufferText = (st.bufferText || "").toString();
                bufferIds = (st.bufferIds || []);
                lastGeminiTime = Number(st.lastGeminiTime || 0);
            }

            if (settingsSnap.exists()) {
                chunkSettings = { ...chunkSettings, ...settingsSnap.val() };
            }

            if (activeSnap.exists()) {
                activeSessionId = activeSnap.val();
                const sessionSnap = await projectRef.child(`sessions/${activeSessionId}`).get();
                if (sessionSnap.exists()) {
                    const s = sessionSnap.val();
                    sessionContext = `Speaker: ${s.speaker}, Topic: ${s.topic}, Abstract: ${s.abstract}, Keywords: ${s.keywords}`;
                    sourceLang = s.sourceLanguage || "ko";
                }
            }
        } catch { // Intentionally empty
        }

        bufferText = bufferText ? bufferText + " " + rawText : rawText;
        bufferIds.push(dataId);

        const now = Date.now();
        const timeDiff = now - lastGeminiTime;
        const isSentenceEnd = chunkSettings.sentenceEnd && /[.!?]$/.test(rawText.trim());
        const isLongEnough = bufferText.length >= chunkSettings.minLength;
        const isTimeOut = timeDiff > chunkSettings.timeoutMs;

        const shouldFlush = isSentenceEnd || isLongEnough || isTimeOut;

        if (!shouldFlush) {
            await projectRef.child('state').update({ bufferText, bufferIds });
            return;
        }

        functions.logger.info("Flushing Buffer", { projectId, lang: sourceLang, textLen: bufferText.length });

        let previousContext = "";
        try {
            const snap = await projectRef.child('state/lastRefinedList').get();
            const list: string[] = snap.exists() ? (snap.val() as string[]) : [];
            // Build context from last 3 refined outputs
            previousContext = list.slice(-3).join(' / ');
        } catch { // Intentionally empty
            void 0;
        }

        let refined = bufferText;
        let firstEn = "";
        let firstJa = "";
        const tGeminiStart = Date.now();

        try {
            const out = await callGeminiREST(bufferText, previousContext, sessionContext, sourceLang);
            refined = sanitize(out.refined || bufferText);
            firstEn = (out.en || "").toString();
            firstJa = (out.ja || "").toString();
        } catch (_err: any) {
            // CRITICAL: ?쒕??섏씠 ?ㅽ뙣 ???먯씤??臾댁“嫄?湲곕줉?댁빞 ??(Silent Failure 諛⑹?)
            functions.logger.error("Gemini Refine Error [FATAL]:", {
                message: _err.message,
                stack: _err.stack,
                bufferTextLen: bufferText.length
            });
            // ?ㅽ뙣 ???먮낯???대낫?대릺, ?먮윭 ?곹솴?꾩쓣 留덊궧???섎룄 ?덉쓬
            refined = bufferText;
        }

        const updates: Record<string, unknown> = {};
        const targetId = bufferIds[0];
        const idsToDelete = bufferIds.slice(1);

        updates[`projects/${projectId}/stream/${targetId}/refined`] = refined;
        updates[`projects/${projectId}/stream/${targetId}/en`] = firstEn;
        updates[`projects/${projectId}/stream/${targetId}/ja`] = firstJa;
        updates[`projects/${projectId}/stream/${targetId}/status`] = "final";
        updates[`projects/${projectId}/stream/${targetId}/geminiMs`] = Date.now() - tGeminiStart;
        updates[`projects/${projectId}/stream/${targetId}/mergedIds`] = idsToDelete;


        for (const pid of idsToDelete) {
            updates[`projects/${projectId}/stream/${pid}/status`] = "merged";
            updates[`projects/${projectId}/stream/${pid}/refined`] = "";
        }

        updates[`projects/${projectId}/state/bufferText`] = "";
        updates[`projects/${projectId}/state/bufferIds`] = [];
        updates[`projects/${projectId}/state/lastGeminiTime`] = Date.now();
        updates[`projects/${projectId}/state/lastRefined`] = refined; // Keep for backward compat

        // Update rolling context list (keep last 5):
        try {
            const listSnap = await projectRef.child('state/lastRefinedList').get();
            const existingList: string[] = listSnap.exists() ? (listSnap.val() as string[]) : [];
            const newList = [...existingList, refined].slice(-5);
            updates[`projects/${projectId}/state/lastRefinedList`] = newList;
        } catch { // Intentionally empty
            void 0;
        }

        await admin.database().ref().update(updates);
    });

// 3. Scheduled Batch: Live Remastering (Every 2 minutes)
export const remasterSession = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .pubsub.schedule("every 2 minutes").onRun(async (_context) => {
        void _context;
        await runRemasterLogic();
    });

// Manual Trigger for Remastering
export const triggerRemaster = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .https.onRequest(async (req, res) => {
        res.set("Access-Control-Allow-Origin", "*");
        if (req.method === "OPTIONS") { res.status(204).send(""); return; }

        try {
            const projectId = (req.query.projectId || "").toString();
            let count = 0;
            if (!projectId) {
                // If no project ID, run for all (batch mode) or error? 
                // Let's run the batch logic for simplicity
                count = await runRemasterLogic() || 0;
            } else {
                // Run for specific project logic (simplified version of batch logic)
                count = await runRemasterLogic(projectId) || 0;
            }
            res.json({ success: true, count });
        } catch (e: unknown) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
    });

const runRemasterLogic = async (targetProjectId?: string): Promise<number | void> => {
    const now = Date.now();
    // Target: Recent 10 minutes (State-based Sweeping)
    // Avoid very recent 30s
    // START_OFFSET removed: unused
    // END_OFFSET removed: unused

    // 1. Get projects
    let projectsSnap: admin.database.DataSnapshot;
    if (targetProjectId) {
        projectsSnap = await admin.database().ref(`projects/${targetProjectId}`).get();
    } else {
        projectsSnap = await admin.database().ref('projects').get();
    }

    if (!projectsSnap.exists()) return;

    const promises: Promise<number>[] = [];

    const processProject = (pSnap: admin.database.DataSnapshot, pid: string) => {
        const pVal = pSnap.val();
        const activeId = pVal.activeSessionId;

        if (!activeId) return;

        // Determine Time Window
        // Force Remaster: Always look back 60 minutes, ignoring lastRemasteredAt
        // This ensures we always re-evaluate the recent context
        const ONE_HOUR = 3600 * 1000;
        const startTime = now - ONE_HOUR;
        const endTime = now - 1000; // Up to 1 second ago

        promises.push((async (): Promise<number> => {
            // 2. Fetch data within time window
            const streamRef = admin.database().ref(`projects/${pid}/stream`);
            const q = streamRef.orderByChild('timestamp').startAt(startTime).endAt(endTime);
            const streamSnap = await q.get();

            if (!streamSnap.exists()) return 0;

            type StreamItem = { id?: string; timestamp?: number; refined?: string; original?: string; sessionId?: string };
            const items: StreamItem[] = [];

            const streamVal = streamSnap.val() || {};
            const entries = Object.entries(streamVal) as [string, unknown][];
            for (const [key, val] of entries) {
                const v = val as { sessionId?: string; status?: string; timestamp?: number; refined?: string; original?: string };
                if (v && v.sessionId === activeId && v.status === 'final') {
                    items.push({ id: key, timestamp: v.timestamp, refined: v.refined, original: v.original, sessionId: v.sessionId });
                }
            }

            if (items.length === 0) return 0; // Nothing to update (Sweeping complete)

            // Sort by timestamp
            const allItems = items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            if (allItems.length < 3) return 0;

            // 3. Prepare Prompt
            const sessionInfo = pVal.sessions?.[activeId] || {};
            const contextText = `Speaker: ${sessionInfo.speaker}, Topic: ${sessionInfo.topic}, Abstract: ${sessionInfo.abstract}`;
            const sourceLang = sessionInfo.sourceLanguage || 'ko';

            // Determine targets:
            // We want to fix broken sentences.
            // We pass ALL items to Gemini, but mark them as "isTarget: true" if they are recent (last 10 mins) OR haven't been remastered.
            // Actually, for "Force Remaster", let's just ask Gemini to review the whole block and fix any broken flows.
            const inputList = allItems.map(i => ({
                id: i.id,
                text: i.refined || i.original,
                // isTarget: !i.isRemastered // OLD LOGIC
                isTarget: true // FORCE LOGIC: Check everything in the window
            }));

            const prompt = `
[TASK: REMASTER TRANSCRIPT]
- Analyze the conversation list (JSON).
- Focus on items where "isTarget": true.
- Use context from other items to fix terminology and flow.
- Output the updated list for TARGET items only.

[REMASTERING RULES]
1. Input Source Language: ${sourceLang}
2. Target Languages: en, ja

[OUTPUT FIELDS]
- "id": The ID of the item being updated (The main sentence).
- "refined": MUST BE in ${sourceLang}. Fix typos and grammar only. DO NOT TRANSLATE.
- "translations": Object containing keys for each target language.
- "mergedIds": Array of IDs that were merged/absorbed into this sentence. (These will be DELETED from the screen).

[RULE]
- If you combine multiple fragments into one complete sentence, use the ID of the FIRST fragment as the main "id", and list all other absorbed IDs in "mergedIds".

[EXAMPLE]
Input: 
Item 1 (ID: A): "1, 2, 3"
Item 2 (ID: B): "Hello"
Item 3 (ID: C): "World"
(Source: en)

Output:
[
  {
    "id": "B",
    "refined": "Hello World.",
    "translations": { "ko": "?덈뀞 ?몄긽??" },
    "mergedIds": ["A", "C"] 
  }
]

[NOISE CLEANUP]
- Remove non-lecture speech like microphone testing ("1, 2, 3, 4", "Ah, ah").
- Fix obvious typos ("??吏꾨즺" -> "猷⑦떞 吏꾨즺" or "?듭떖 吏꾨즺" based on context).
- If a sentence is broken, merge it with the next one to make a complete paragraph.
- If the Korean sentence lacks a subject (e.g., "沅뚭퀬?⑸땲??), add a proper subject like "We recommend" or "It is recommended" based on context.
- Ensure the final English output forms complete, professional sentences suitable for a medical lecture.

[Session Abstract]
${contextText}

[INPUT JSON]
${JSON.stringify(inputList)}
`;
            // 4. Call Gemini Pro
            try {
                const apiKeys = getGeminiKeys();
                type GeminiProPayload = {
                    contents: { parts: { text: string }[] }[];
                    generationConfig: { responseMimeType: string };
                };
                const payload: GeminiProPayload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }

                let data = null;
                for (const apiKey of apiKeys) {
                    const res = await fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    if (res.ok) {
                        data = await res.json();
                        break;
                    }
                    if (res.status === 429) continue; // Try next key
                }

                if (!data) return 0;

                const outText = (((data || {}).candidates || [])[0] || {}).content?.parts?.[0]?.text || "";
                if (!outText) return 0;

                const cleanText = outText.replace(/```json\s*|```/g, "").trim();
                const refinedList = JSON.parse(cleanText);

                if (!Array.isArray(refinedList)) return 0;

                // 5. Update DB
                const updates: Record<string, unknown> = {};
                for (const item of refinedList) {
                    if (!item || !item.id) continue;
                    const originalItem = items.find(i => i.id === item.id);

                    if (originalItem && item.refined) {
                        // Safety Guard: Check if source language is preserved
                        if (sourceLang === 'ko' && !/[????????媛-??/.test(item.refined)) {
                            functions.logger.warn(`Safety Guard: Dropped English update for Korean field`, item);
                            continue; // Skip this update
                        }

                        updates[`projects/${pid}/stream/${item.id}/refined`] = sanitize(item.refined);
                        if (item.translations) {
                            if (item.translations.en) updates[`projects/${pid}/stream/${item.id}/en`] = sanitize(item.translations.en);
                            if (item.translations.ja) updates[`projects/${pid}/stream/${item.id}/ja`] = sanitize(item.translations.ja);
                        }
                        updates[`projects/${pid}/stream/${item.id}/isRemastered`] = true;

                        // Handle Merged IDs (Delete them)
                        if (item.mergedIds && Array.isArray(item.mergedIds)) {
                            item.mergedIds.forEach((mid: string) => {
                                if (mid !== item.id) { // Prevent self-deletion
                                    updates[`projects/${pid}/stream/${mid}`] = null; // Delete from DB
                                }
                            });
                        }

                    }
                }

                // Update lastRemasteredAt to the max timestamp of fetched items
                let maxTimestamp = 0;
                if (items.length > 0) {
                    maxTimestamp = Math.max(...items.map(i => i.timestamp || 0));
                }

                if (maxTimestamp > 0) {
                    updates[`projects/${pid}/settings/lastRemasteredAt`] = maxTimestamp;
                }

                if (Object.keys(updates).length > 0) {
                    await admin.database().ref().update(updates);
                    functions.logger.info(`Remastered ${Object.keys(updates).length} items for ${pid}`);
                    return Object.keys(updates).length; // Return count
                }

                // Even if no updates, update pointer
                if (maxTimestamp > 0) {
                    await admin.database().ref(`projects/${pid}/settings/lastRemasteredAt`).set(maxTimestamp);
                }

                return 0;

            } catch (e: unknown) {
                functions.logger.error("Remaster Inner Error", e);
                throw new Error(`Inner Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        })());
    };

    if (targetProjectId) {
        processProject(projectsSnap, targetProjectId);
    } else {
        projectsSnap.forEach((pSnap) => { processProject(pSnap, pSnap.key!); });
    }

    const results = await Promise.all(promises);
    const totalCount = results.reduce((a, b) => (a || 0) + (b || 0), 0);
    return totalCount;
};
