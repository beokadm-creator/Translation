import { useState, useEffect, useRef } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, off, get, query, limitToLast, orderByChild, endBefore } from 'firebase/database';

export const useProjectStream = (projectIdOrSlug: string | undefined, options: { subscribe?: boolean } = { subscribe: true }) => {
  const [realProjectId, setRealProjectId] = useState<string | null>(null);
  const [streamData, setStreamData] = useState<Record<string, { original: string; refined?: string; ko?: string; en?: string; ja?: string; status: 'raw' | 'translating' | 'final' | 'merged'; timestamp: number; seq?: number; mergedIds?: string[] } | null> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const oldestTimestampRef = useRef<number | null>(null);

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
          
          setStreamData(prev => ({
            ...data,
            ...prev
          }));
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

          streamListener = (snapshot) => {
            if (!mounted) return;
            const data = snapshot.val() || {};
            
            // 초기 로딩 시 가장 오래된 메시지 타임스탬프 기록
            if (!oldestTimestampRef.current && Object.keys(data).length > 0) {
              const items = Object.values(data) as any[];
              oldestTimestampRef.current = Math.min(...items.map(i => i.timestamp));
            }

            // 새로운 데이터가 도착하면 기존 과거 데이터와 병합(Merge)하여 덮어쓰기 방지
            setStreamData(prev => ({
              ...prev,
              ...data
            }));
            setLoading(false);
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
      if (streamRef && streamListener) {
        off(streamRef, 'value', streamListener);
      }
    };
  }, [projectIdOrSlug, options.subscribe]);

  return { realProjectId, streamData, loading, error, loadOlderMessages, hasMore };
};
