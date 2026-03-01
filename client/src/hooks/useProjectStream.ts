import { useState, useEffect } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, off } from 'firebase/database';

export const useProjectStream = (projectIdOrSlug: string | undefined, options: { subscribe?: boolean } = { subscribe: true }) => {
  const [realProjectId, setRealProjectId] = useState<string | null>(null);
  const [streamData, setStreamData] = useState<Record<string, { original: string; refined?: string; en?: string; ja?: string; status: 'raw' | 'final' | 'merged'; timestamp: number; mergedIds?: string[] } | null> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
          streamRef = ref(rtdb, `projects/${resolvedId}/stream`);
          streamListener = (snapshot) => {
            if (!mounted) return;
            setStreamData(snapshot.val() as typeof streamData);
          };
          onValue(streamRef, streamListener, (err) => {
            console.error("Stream subscription error:", err);
            if (mounted) setError(err instanceof Error ? err.message : String(err));
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

  return { realProjectId, streamData, loading, error };
};
