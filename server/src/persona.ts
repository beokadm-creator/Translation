// Server-side persona loader.
//
// Two-tier lookup: per-session override (projects/{p}/sessions/{s}/persona)
// wins over the project default (projects/{p}/settings/persona). This lets a
// dental conference run an "opening ceremony" persona without medical terms
// for one session and the full clinical persona for the next, without ever
// reloading the admin dashboard.
//
// The relay reads this on session start (with 5-minute in-memory cache) so
// even if the client init payload omits or stales the persona, the server
// still applies it to both the STT prompt and the refinement prompt.

import * as admin from "firebase-admin"
import type { PersonaConfig } from "./translate.js"

interface CacheEntry {
    data: PersonaConfig | null
    expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 100
const cache = new Map<string, CacheEntry>()

function evict(now: number): void {
    if (cache.size <= CACHE_MAX) return
    for (const [key, entry] of cache.entries()) {
        if (entry.expiresAt <= now) cache.delete(key)
    }
    if (cache.size > CACHE_MAX) {
        const first = cache.keys().next().value
        if (first) cache.delete(first)
    }
}

async function readPath(path: string): Promise<PersonaConfig | null> {
    try {
        const snap = await admin.database().ref(path).get()
        if (!snap.exists()) return null
        return snap.val() as PersonaConfig
    } catch {
        return null
    }
}

/**
 * Resolve the active persona for the given (projectId, sessionId) pair.
 *
 *   1. If the session has its own persona with `enabled: true`, return it.
 *   2. Otherwise, return the project-level default (may be disabled or null).
 *
 * Both lookups are cached for 5 minutes under composite keys.
 *
 * Pass `forceFresh: true` to bypass the cache — used by the Realtime relay
 * on session start so admins never see a stale persona after editing it
 * just before clicking START BROADCAST.
 */
export async function loadPersona(
    projectId: string,
    sessionId?: string,
    forceFresh = false,
): Promise<PersonaConfig | null> {
    if (!projectId) return null

    const now = Date.now()
    evict(now)

    const cacheKey = sessionId ? `${projectId}::${sessionId}` : projectId
    if (!forceFresh) {
        const cached = cache.get(cacheKey)
        if (cached && cached.expiresAt > now) return cached.data
    }

    let resolved: PersonaConfig | null = null

    if (sessionId) {
        const sessionPersona = await readPath(
            `projects/${projectId}/sessions/${sessionId}/persona`,
        )
        if (sessionPersona && sessionPersona.enabled) {
            resolved = sessionPersona
        }
    }

    if (!resolved) {
        resolved = await readPath(`projects/${projectId}/settings/persona`)
    }

    cache.set(cacheKey, { data: resolved, expiresAt: now + CACHE_TTL_MS })
    return resolved
}

/**
 * Merge a client-provided persona override (if any) on top of the canonical
 * RTDB-stored persona. The server-stored value wins for safety: an admin
 * may toggle persona.enabled while a session is in flight.
 */
export function mergePersona(
    fromServer: PersonaConfig | null,
    fromClient: PersonaConfig | null,
): PersonaConfig | null {
    if (!fromServer && !fromClient) return null
    if (!fromClient) return fromServer
    if (!fromServer) return fromClient
    return {
        enabled: fromServer.enabled,
        basePromptKo: fromServer.basePromptKo ?? fromClient.basePromptKo,
        basePromptEn: fromServer.basePromptEn ?? fromClient.basePromptEn,
        basePromptJa: fromServer.basePromptJa ?? fromClient.basePromptJa,
        basePromptZh: fromServer.basePromptZh ?? fromClient.basePromptZh,
        customInstructions: fromServer.customInstructions ?? fromClient.customInstructions,
        medicalTerms: fromServer.medicalTerms ?? fromClient.medicalTerms,
    }
}
