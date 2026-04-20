import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import type { Request } from "express";

// API Key Auth middleware
const authenticateAPIKey = (req: Request) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return false;
    }
    
    const token = authHeader.split("Bearer ")[1];
    const expectedKey = process.env.ADMIN_API_KEY || (functions.config()?.admin?.apikey as string);
    
    // Fallback for development if no key is set (DANGEROUS in prod)
    if (!expectedKey) {
        functions.logger.warn("ADMIN_API_KEY is not set in environment. Falling back to default key.");
        return token === "hongcomm-admin-secret-2025";
    }

    return token === expectedKey;
};

export const createConferenceAPI = functions.https.onRequest(async (req, res) => {
    // CORS Handling
    const origin = req.headers.origin as string;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || (functions.config()?.app?.allowed_origin as string) || "*";
    if (allowedOrigin === "*" || allowedOrigin === origin) {
        res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    } else {
        res.set("Access-Control-Allow-Origin", origin || allowedOrigin);
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    if (req.method !== "POST") {
        res.status(405).json({ success: false, error: "Method not allowed" });
        return;
    }

    if (!authenticateAPIKey(req as Request)) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
    }

    try {
        const { title, accessCode, startDate, endDate, projects } = req.body;

        if (!title || !startDate || !endDate) {
            res.status(400).json({ success: false, error: "Missing required fields: title, startDate, endDate" });
            return;
        }

        const db = admin.database();
        const confId = `conf_${Date.now()}`;
        const dates = `${startDate} ~ ${endDate}`;

        const updates: Record<string, any> = {};

        // 1. 학술대회(Conference) 데이터 세팅
        updates[`conferences/${confId}`] = {
            id: confId,
            title,
            dates,
            startDate,
            endDate,
            createdAt: admin.database.ServerValue.TIMESTAMP
        };

        // 2. 소속된 프로젝트(Hall) 데이터 세팅 (선택사항)
        if (Array.isArray(projects) && projects.length > 0) {
            projects.forEach((proj: any, index: number) => {
                if (!proj.name || !proj.slug) return; // Skip invalid projects

                const projectId = proj.slug.replace(/[^a-z0-9-_]/gi, '').toLowerCase();
                
                updates[`projects/${projectId}/settings`] = {
                    name: proj.name,
                    slug: projectId,
                    date: proj.date || startDate,
                    targetLanguages: proj.targetLanguages || ["ko", "en", "ja", "zh"],
                    parkingMessage: proj.parkingMessage || "The session will start shortly.",
                    conferenceId: confId,
                    // Default AI & Overlay settings
                    hideRaw: true,
                    ai: {
                        primarySTT: "openai", fallbackSTT: "deepgram",
                        primaryTrans: "openai", fallbackTrans: "claude"
                    },
                    overlay: {
                        fontSize: 48, fontColor: '#ffffff', fontWeight: 'bold', 
                        bgColor: '#000000', bgOpacity: 0.6, padding: 40, 
                        textEffect: 'shadow', align: 'center', displayStyle: 'youtube', 
                        letterSpacing: 0, maxLines: 2, lineHeight: 1.5, 
                        fontFamily: 'sans-serif', typingSpeed: 35, bottomOffset: 60
                    }
                };

                // 3. 개별 프로젝트(Hall) 하위의 시간표/연자(Sessions) 세팅
                if (Array.isArray(proj.sessions) && proj.sessions.length > 0) {
                    proj.sessions.forEach((sess: any, sIdx: number) => {
                        const sessionId = sess.id || `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                        updates[`projects/${projectId}/sessions/${sessionId}`] = {
                            id: sessionId,
                            speaker: sess.speaker || "",
                            affiliation: sess.affiliation || "",
                            topic: sess.topic || "",
                            abstract: sess.abstract || "",
                            keywords: sess.keywords || "",
                            startTime: sess.startTime || "00:00",
                            orderIndex: typeof sess.orderIndex === 'number' ? sess.orderIndex : sIdx,
                            sourceLanguage: sess.sourceLanguage || "ko",
                        };
                    });
                }
            });
        }

        // 트랜잭션처럼 한 번에 일괄 업데이트
        await db.ref().update(updates);

        functions.logger.info(`[API] Created Conference ${confId} with ${Array.isArray(projects) ? projects.length : 0} projects.`);
        res.status(200).json({ success: true, conferenceId: confId, message: "Successfully created conference and projects." });

    } catch (error: any) {
        functions.logger.error("[API] Failed to create conference", error);
        res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
});

// Helper for CORS and Auth
const handleCorsAndAuth = (req: Request, res: any) => {
    const origin = req.headers.origin as string;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || (functions.config()?.app?.allowed_origin as string) || "*";
    if (allowedOrigin === "*" || allowedOrigin === origin) {
        res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    } else {
        res.set("Access-Control-Allow-Origin", origin || allowedOrigin);
    }
    res.set("Access-Control-Allow-Methods", "DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return false; }

    if (req.method !== "DELETE") {
        res.status(405).json({ success: false, error: "Method not allowed" });
        return false;
    }

    if (!authenticateAPIKey(req as Request)) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return false;
    }
    return true;
};

export const deleteConferenceAPI = functions.https.onRequest(async (req, res) => {
    if (!handleCorsAndAuth(req as Request, res)) return;

    try {
        const { confId } = req.body;
        if (!confId) {
            res.status(400).json({ success: false, error: "Missing required field: confId" });
            return;
        }

        const db = admin.database();
        const updates: Record<string, any> = {};

        // 1. 대회 삭제
        updates[`conferences/${confId}`] = null;

        // 2. 해당 대회에 속한 프로젝트 찾아서 삭제
        const projSnap = await db.ref('projects').once('value');
        if (projSnap.exists()) {
            const projects = projSnap.val();
            Object.keys(projects).forEach(projectId => {
                if (projects[projectId]?.settings?.conferenceId === confId) {
                    updates[`projects/${projectId}`] = null; // 프로젝트 하위의 settings, sessions, stream 등 모두 삭제
                }
            });
        }

        await db.ref().update(updates);
        functions.logger.info(`[API] Deleted Conference ${confId} and its projects.`);
        res.status(200).json({ success: true, deleted: { confId } });
    } catch (error: any) {
        functions.logger.error("[API] Failed to delete conference", error);
        res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
});

export const deleteProjectAPI = functions.https.onRequest(async (req, res) => {
    if (!handleCorsAndAuth(req as Request, res)) return;

    try {
        const { projectId } = req.body;
        if (!projectId) {
            res.status(400).json({ success: false, error: "Missing required field: projectId" });
            return;
        }

        const db = admin.database();
        await db.ref(`projects/${projectId}`).remove();

        functions.logger.info(`[API] Deleted Project ${projectId}.`);
        res.status(200).json({ success: true, deleted: { projectId } });
    } catch (error: any) {
        functions.logger.error("[API] Failed to delete project", error);
        res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
});

export const replaceSessionsAPI = functions.https.onRequest(async (req, res) => {
    // 1. CORS Handling
    const origin = req.headers.origin as string;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || (functions.config()?.app?.allowed_origin as string) || "*";
    if (allowedOrigin === "*" || allowedOrigin === origin) {
        res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    } else {
        res.set("Access-Control-Allow-Origin", origin || allowedOrigin);
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    if (req.method !== "POST") {
        res.status(405).json({ success: false, error: "Method not allowed" });
        return;
    }

    // 2. Auth
    if (!authenticateAPIKey(req as Request)) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
    }

    try {
        const { conferenceId, projectSlug, sessions } = req.body;

        if (!projectSlug || !Array.isArray(sessions)) {
            res.status(400).json({ success: false, error: "Missing required fields: projectSlug, sessions (array)" });
            return;
        }

        const db = admin.database();
        const projectId = projectSlug.replace(/[^a-z0-9-_]/gi, '').toLowerCase();

        // 3. 기존 세션 데이터 검증 및 삭제
        const projectRef = db.ref(`projects/${projectId}`);
        const snap = await projectRef.child('settings').once('value');
        if (!snap.exists()) {
            res.status(404).json({ success: false, error: `Project ${projectId} not found` });
            return;
        }
        
        // conferenceId가 제공된 경우 일치 여부 확인 (옵션)
        if (conferenceId && snap.val().conferenceId !== conferenceId) {
            res.status(400).json({ success: false, error: `Project ${projectId} does not belong to conference ${conferenceId}` });
            return;
        }

        const sessionsObj: Record<string, any> = {};
        
        // 4. 새 세션 데이터 포맷팅
        sessions.forEach((sess: any, sIdx: number) => {
            const sessionId = sess.id || `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            sessionsObj[sessionId] = {
                id: sessionId,
                speaker: sess.speaker || "",
                affiliation: sess.affiliation || "",
                topic: sess.topic || "",
                abstract: sess.abstract || "",
                keywords: sess.keywords || "",
                startTime: sess.startTime || "00:00",
                orderIndex: typeof sess.orderIndex === 'number' ? sess.orderIndex : sIdx,
                sourceLanguage: sess.sourceLanguage || "ko",
            };
        });

        // 5. 전체 덮어쓰기 (기존 sessions 노드를 완전히 교체)
        await projectRef.child('sessions').set(sessionsObj);

        functions.logger.info(`[API] Replaced sessions for project ${projectId}. Total: ${sessions.length}`);
        res.status(200).json({ success: true, message: "Successfully replaced sessions.", count: sessions.length });

    } catch (error: any) {
        functions.logger.error("[API] Failed to replace sessions", error);
        res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
});

export const deleteSessionAPI = functions.https.onRequest(async (req, res) => {
    if (!handleCorsAndAuth(req as Request, res)) return;

    try {
        const { projectId, sessionId } = req.body;
        if (!projectId || !sessionId) {
            res.status(400).json({ success: false, error: "Missing required fields: projectId, sessionId" });
            return;
        }

        const db = admin.database();
        await db.ref(`projects/${projectId}/sessions/${sessionId}`).remove();

        functions.logger.info(`[API] Deleted Session ${sessionId} in Project ${projectId}.`);
        res.status(200).json({ success: true, deleted: { projectId, sessionId } });
    } catch (error: any) {
        functions.logger.error("[API] Failed to delete session", error);
        res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
});