import { useState, useEffect, useRef } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, off, get, query, limitToLast, orderByChild, endBefore } from 'firebase/database';

export const useProjectStream = (projectIdOrSlug: string | undefined, options: { subscribe?: boolean; maxItems?: number } = { subscribe: true }) => {
  const [realProjectId, setRealProjectId] = useState<string | null>(null);
  const [streamData, setStreamData] = useState<Record<string, { original: string; refined?: string; ko?: string; en?: string; ja?: string; status: 'raw' | 'translating' | 'final' | 'merged'; timestamp: number; seq?: number; mergedIds?: string[] } | null> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const oldestTimestampRef = useRef<number | null>(null);
  const maxItems = Math.max(50, options.maxItems ?? 2000);

  const trimStreamData = (data: Record<string, unknown>) => {
    const entries = Object.entries(data).filter(([, v]) => {
      if (!v || typeof v !== 'object') return false;
      const ts = (v as { timestamp?: unknown }).timestamp;
      return typeof ts === 'number';
    }) as Array<[string, { timestamp: number }]>;
    if (entries.length <= maxItems) return data;
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    return Object.fromEntries(entries.slice(-maxItems));
  };

  // 과거 데이터(이전 50개)를 불러오는 페이징 함수
  const loadOlderMessages = async () => {
    if (!realProjectId || !hasMore || !oldestTimestampRef.current) return;
    
    try {
      const olderQuery = query(
        ref(rtdb, `projects/${realProjectId}/stream`),
        orderByChild('timestamp'),
        endBefore(oldestTimestampRef.current),
        limitToLast(50)
      );
      
      const snapshot = await get(olderQuery);
      const data = snapshot.val();
      
      if (data) {
        const items = Object.values(data) as any[];
        if (items.length > 0) {
          const newOldest = Math.min(...items.map(i => i.timestamp));
          oldestTimestampRef.current = newOldest;
          
          setStreamData(prev => {
            const merged = { ...data, ...(prev || {}) };
            const trimmed = trimStreamData(merged) as Record<string, any>;
            const nextItems = Object.values(trimmed) as any[];
            oldestTimestampRef.current = nextItems.length ? Math.min(...nextItems.map(i => i.timestamp)) : null;
            return trimmed;
          });
        }
        if (items.length < 50) {
          setHasMore(false); // 더 이상 불러올 과거 데이터가 없음
        }
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("과거 메시지 불러오기 실패:", err);
    }
  };

  useEffect(() => {
    if (!projectIdOrSlug) {
      setLoading(false);
      return;
    }

    let mounted = true;
    let streamRef: ReturnType<typeof ref> | null = null;
    let streamListener: ((snapshot: { val: () => unknown }) => void) | null = null;
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveAndSubscribe = async () => {
      try {
        setLoading(true);
        const resolvedId = projectIdOrSlug;
        setRealProjectId(resolvedId);

        // Subscribe to Stream
        if (options.subscribe) {
          // 전체를 무식하게 가져오지 않고 최근 50개만 제한(limitToLast)하여 가져옴
          const streamQuery = query(
            ref(rtdb, `projects/${resolvedId}/stream`),
            orderByChild('timestamp'),
            limitToLast(50)
          );
          streamRef = streamQuery as any;

          let lastUpdateTs = 0;

          const applySnapshot = (snapshot: any) => {
            if (!mounted) return;
            const raw = snapshot.val();
            if (!raw || Object.keys(raw).length === 0) {
              oldestTimestampRef.current = null;
              setHasMore(false);
              setStreamData({});
              setLoading(false);
              return;
            }
            const data = raw as Record<string, any>;
            
            // 초기 로딩 시 가장 오래된 메시지 타임스탬프 기록
            if (!oldestTimestampRef.current && Object.keys(data).length > 0) {
              const items = Object.values(data) as any[];
              oldestTimestampRef.current = Math.min(...items.map(i => i.timestamp));
            }

            // 새로운 데이터가 도착하면 기존 과거 데이터와 병합(Merge)하여 덮어쓰기 방지
            setStreamData(prev => {
              if (!prev) return trimStreamData(data) as Record<string, any>;
              
              const dataItems = Object.values(data) as any[];
              const isFull = dataItems.length >= 50; // limitToLast 값과 일치
              const minDataTs = dataItems.length > 0 ? Math.min(...dataItems.map(i => i.timestamp)) : 0;
              
              const next = { ...prev };
              
              // ── 핵심 버그 수정: DB에서 삭제된(초기화/아카이브) 항목을 prev에서 제거 ──
              // data(최근 50개)에 포함되어야 할 시간대(minDataTs 이상)인데 data에 없다면 삭제된 것임
              Object.keys(next).forEach(k => {
                  const item = next[k];
                  if (!item) return;
                  if (isFull) {
                      if (item.timestamp >= minDataTs && !data[k]) {
                          delete next[k];
                      }
                  } else {
                      if (!data[k]) {
                          delete next[k];
                      }
                  }
              });

              const merged = { ...next, ...data };
              const trimmed = trimStreamData(merged) as Record<string, any>;
              const nextItems = Object.values(trimmed) as any[];
              oldestTimestampRef.current = nextItems.length ? Math.min(...nextItems.map(i => i.timestamp)) : null;
              return trimmed;
            });
            setLoading(false);
          };

          streamListener = (snapshot) => {
            const now = Date.now();
            if (lastUpdateTs > 0 && now - lastUpdateTs < 100) {
              // Throttling: Schedule the latest snapshot to be applied later
              if (throttleTimer) clearTimeout(throttleTimer);
              throttleTimer = setTimeout(() => {
                lastUpdateTs = Date.now();
                applySnapshot(snapshot);
              }, 100 - (now - lastUpdateTs));
              return;
            }
            // First time or after throttle interval
            lastUpdateTs = now;
            applySnapshot(snapshot);
          };
          onValue(streamQuery, streamListener, (err) => {
            console.error("Stream subscription error:", err);
            if (mounted) {
              setError(err instanceof Error ? err.message : String(err));
              setLoading(false);
            }
          });
        }

      } catch (err: unknown) {
        console.error("Error in useProjectStream:", err);
        if (mounted) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    resolveAndSubscribe();

    return () => {
      mounted = false;
      if (throttleTimer) clearTimeout(throttleTimer);
      if (streamRef && streamListener) {
        off(streamRef, 'value', streamListener);
      }
    };
  }, [projectIdOrSlug, options.subscribe]);

  return { realProjectId, streamData, loading, error, loadOlderMessages, hasMore };
};
