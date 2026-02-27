// Version: v7.9 (Language Locking)
import * as functions from "firebase-functions/v1"
import * as admin from "firebase-admin"
import OpenAI from "openai"
import { Readable } from "stream"

let _openai: OpenAI | null = null
const getGeminiKey = (): string => {
    const key = process.env.GEMINI_API_KEY || (functions.config()?.gemini?.key as string) || "";
    if (!key) functions.logger.warn("GEMINI_API_KEY is not set.");
    return key;
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
- If the input Korean seems like a typo (e.g., "불유부" -> sounds like "분류"), fix the Korean mentally and translate the intended meaning (e.g., "Classification").

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

${sessionContext ? `SESSION INFO: ${sessionContext}` : ""}
${previousContext ? `PREVIOUS CONTEXT: ${previousContext}` : ""}
INPUT: `;
};

const callGeminiREST = async (text: string, previousContext: string, sessionContext: string, sourceLang: string): Promise<{ isMedicalContext?: boolean, refined?: string, en?: string, ja?: string }> => {
    const prompt = getDynamicPrompt(sourceLang, sessionContext, previousContext);

    const payload: any = { contents: [{ parts: [{ text: `${prompt}"${text}"` }] }], generationConfig: { responseMimeType: "application/json" } }
    const apiKey = getGeminiKey();

    let res = await fetch(GEMINI_FLASH_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    if (!res.ok) {
        const errText = await res.text()
        functions.logger.error("Gemini REST error", { status: res.status, body: errText })
        res = await fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        if (!res.ok) {
            throw new Error(`Gemini REST Error: ${res.status}`)
        }
    }
    const data = await res.json()
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

// TTS Helper
const generateTTS = async (text: string, lang: string, projectId: string, sessionId: string, seq: number): Promise<string | null> => {
    const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return null;

    // Filter out very short text or garbage
    if (!text || text.length < 2) return null;

    const voiceName = lang === 'ko' ? 'ko-KR-Neural2-C' : 'en-US-Neural2-J';
    const languageCode = lang === 'ko' ? 'ko-KR' : 'en-US';

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const payload = {
        input: { text },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: 'MP3' }
    };

    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!data.audioContent) {
            functions.logger.error("TTS Failed", data);
            return null;
        }

        const bucketName = "translation-comm.firebasestorage.app"; // Hardcoded or env
        const bucket = admin.storage().bucket(bucketName);
        const filePath = `audios/${projectId}/${sessionId}/${seq}.mp3`;
        const file = bucket.file(filePath);

        await file.save(Buffer.from(data.audioContent, 'base64'), {
            metadata: { contentType: 'audio/mpeg' }
        });

        await file.makePublic();
        return `https://storage.googleapis.com/${bucketName}/${filePath}`;
    } catch (e) {
        functions.logger.error("TTS Error", e);
        return null;
    }
};

const DENTAL_PROMPT = "치과, 임플란트, 보철, 수술, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, Implant, Surgery, Bone Graft, Fixture, Abutment, Crown"

const sanitize = (s: string): string => {
    let t = (s || "").toString();
    t = t.replace(/[`]{3,}/g, "").replace(/[`]/g, "");
    t = t.replace(/\bundefined\b/gi, "");
    return t.trim();
}

const HALLUCINATION_BLACKLIST = ['자막제작', '자막 제작', 'Subtitles by', 'MBC 뉴스', 'Copyright', 'http', '.co.kr'];
const isLoopPattern = (text: string): boolean => {
    if (HALLUCINATION_BLACKLIST.some(b => text.includes(b))) return true;
    if (/(.+)\1{2,}/.test(text)) return true;
    if (/(.*,){4,}/.test(text)) return true;
    if (/^(Implant, Surgery|임플란트, 보철)/i.test(text)) return true;
    return false;
};

// 1. HTTP Trigger: Receive Audio -> STT (Language Locked) -> Save Raw
export const processAudio = functions
    .runWith({ timeoutSeconds: 60, memory: "512MB" })
    .https.onRequest(async (req, res) => {
        const versionTag = "v7.9_lang_lock"
        res.set("Access-Control-Allow-Origin", "*")
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
            const raw = (req as any).rawBody as Buffer | undefined
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
            } catch { }

            await admin.database().ref(`projects/${projectId}/status`).update({ lastActive: Date.now() }).catch(() => { })

            let openai: OpenAI
            try { openai = getOpenAI() } catch (cfgErr: any) { res.status(500).json({ success: false }); return; }

            if (buf.length < 2000) { res.status(200).json({ success: false, error: "TooSmall" }); return; }

            let stt: any
            try {
                const audioStream = Readable.from(buf)
                    ; (audioStream as any).path = "audio.webm"
                stt = await openai.audio.transcriptions.create({
                    file: audioStream as any,
                    model: "whisper-1",
                    language: sourceLang, // LOCKED!
                    prompt: DENTAL_PROMPT,
                    temperature: 0
                })
                await admin.database().ref(`projects/${projectId}/status/services/openai`).set({ state: "ok", ts: Date.now() }).catch(() => { })
            } catch (err) {
                // Retry with mp4 ext if needed, but let's keep it simple for now
                res.status(200).json({ success: false, error: "WhisperFailed" });
                return;
            }

            let rawText = sanitize((stt?.text || "").trim())
            if (rawText.length < 2) rawText = "";
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

        } catch (e: any) {
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
        let chunkSettings = { minLength: 50, timeoutMs: 6000, sentenceEnd: true }; // Default

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
        } catch { }

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
            const snap = await projectRef.child('state/lastRefined').get();
            previousContext = (snap.val() || "").toString();
        } catch { }

        let refined = bufferText;
        let firstEn = "";
        let firstJa = "";
        const tGeminiStart = Date.now();

        try {
            const out = await callGeminiREST(bufferText, previousContext, sessionContext, sourceLang);
            refined = sanitize(out.refined || bufferText);
            firstEn = (out.en || "").toString();
            firstJa = (out.ja || "").toString();
        } catch (err) {
            refined = bufferText;
        }

        const updates: any = {};
        const targetId = bufferIds[0];
        const idsToDelete = bufferIds.slice(1);

        updates[`projects/${projectId}/stream/${targetId}/refined`] = refined;
        updates[`projects/${projectId}/stream/${targetId}/en`] = firstEn;
        updates[`projects/${projectId}/stream/${targetId}/ja`] = firstJa;
        updates[`projects/${projectId}/stream/${targetId}/status`] = "final";
        updates[`projects/${projectId}/stream/${targetId}/geminiMs`] = Date.now() - tGeminiStart;
        updates[`projects/${projectId}/stream/${targetId}/mergedIds`] = idsToDelete;

        // TTS Trigger (Refine)
        try {
            const targetSnap = await admin.database().ref(`projects/${projectId}/stream/${targetId}`).get();
            if (targetSnap.exists()) {
                const tVal = targetSnap.val();
                const tSeq = tVal.seq;
                const tSessionId = tVal.sessionId || activeSessionId;

                if (tSeq && tSessionId) {
                    const audioUrl = await generateTTS(refined, sourceLang, projectId, tSessionId, tSeq);
                    if (audioUrl) {
                        updates[`projects/${projectId}/stream/${targetId}/audioUrl`] = audioUrl;
                    }
                }
            }
        } catch (e) {
            functions.logger.error("TTS Gen Error (Refine)", e);
        }

        for (const pid of idsToDelete) {
            updates[`projects/${projectId}/stream/${pid}/status`] = "merged";
            updates[`projects/${projectId}/stream/${pid}/refined`] = "";
        }

        updates[`projects/${projectId}/state/bufferText`] = "";
        updates[`projects/${projectId}/state/bufferIds`] = [];
        updates[`projects/${projectId}/state/lastGeminiTime`] = Date.now();
        updates[`projects/${projectId}/state/lastRefined`] = refined;

        await admin.database().ref().update(updates);
    });

// 3. Scheduled Batch: Live Remastering (Every 2 minutes)
export const remasterSession = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .pubsub.schedule("every 2 minutes").onRun(async (context) => {
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
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

const runRemasterLogic = async (targetProjectId?: string): Promise<number | void> => {
    const now = Date.now();
    // Target: Recent 10 minutes (State-based Sweeping)
    // Avoid very recent 30s
    const START_OFFSET = 600 * 1000; // 10 min
    const END_OFFSET = 30 * 1000;    // 30s

    // 1. Get projects
    let projectsSnap;
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
        const lastRemasteredAt = Number(pVal.settings?.lastRemasteredAt || 0);

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

            const items: any[] = [];

            streamSnap.forEach(child => {
                const val = child.val();
                if (val.sessionId === activeId && val.status === 'final') {
                    items.push({ id: child.key, ...val });
                }
            });

            if (items.length === 0) return 0; // Nothing to update (Sweeping complete)

            // Sort by timestamp
            const allItems = items.sort((a, b) => a.timestamp - b.timestamp);

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
    "translations": { "ko": "안녕 세상아." },
    "mergedIds": ["A", "C"] 
  }
]

[NOISE CLEANUP]
- Remove non-lecture speech like microphone testing ("1, 2, 3, 4", "Ah, ah").
- Fix obvious typos ("띵 진료" -> "루틴 진료" or "핵심 진료" based on context).
- If a sentence is broken, merge it with the next one to make a complete paragraph.
- If the Korean sentence lacks a subject (e.g., "권고합니다"), add a proper subject like "We recommend" or "It is recommended" based on context.
- Ensure the final English output forms complete, professional sentences suitable for a medical lecture.

[Session Abstract]
${contextText}

[INPUT JSON]
${JSON.stringify(inputList)}
`;
            // 4. Call Gemini Pro
            try {
                const apiKey = getGeminiKey();
                const payload: any = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }
                const res = await fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                if (!res.ok) return 0;

                const data = await res.json();
                const outText = (((data || {}).candidates || [])[0] || {}).content?.parts?.[0]?.text || "";
                if (!outText) return 0;

                const cleanText = outText.replace(/```json\s*|```/g, "").trim();
                const refinedList = JSON.parse(cleanText);

                if (!Array.isArray(refinedList)) return 0;

                // 5. Update DB
                const updates: any = {};
                for (const item of refinedList) {
                    if (!item || !item.id) continue;
                    const originalItem = items.find(i => i.id === item.id);

                    if (originalItem && item.refined) {
                        // Safety Guard: Check if source language is preserved
                        if (sourceLang === 'ko' && !/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(item.refined)) {
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

                        // TTS Trigger (Remaster)
                        const rSeq = originalItem.seq;
                        const rSessionId = originalItem.sessionId;
                        if (rSeq && rSessionId) {
                            try {
                                const audioUrl = await generateTTS(sanitize(item.refined), sourceLang, pid, rSessionId, rSeq);
                                if (audioUrl) {
                                    updates[`projects/${pid}/stream/${item.id}/audioUrl`] = audioUrl;
                                }
                            } catch (e) { }
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

            } catch (e: any) {
                functions.logger.error("Remaster Inner Error", e);
                throw new Error(`Inner Error: ${e.message}`);
            }
        })());
    };

    if (targetProjectId) {
        processProject(projectsSnap, targetProjectId);
    } else {
        projectsSnap.forEach((pSnap) => processProject(pSnap, pSnap.key!));
    }

    const results = await Promise.all(promises);
    const totalCount = results.reduce((a, b) => (a || 0) + (b || 0), 0);
    return totalCount;
};
