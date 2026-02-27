import { useState, useEffect } from 'react';
import { rtdb } from '../firebase';
import { ref, onValue, off } from 'firebase/database';

export const useProjectStream = (projectIdOrSlug: string | undefined, options: { subscribe?: boolean } = { subscribe: true }) => {
  const [realProjectId, setRealProjectId] = useState<string | null>(null);
  const [streamData, setStreamData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectIdOrSlug) {
      setLoading(false);
      return;
    }

    let mounted = true;
    let streamRef: any = null;
    let streamListener: any = null;

    const resolveAndSubscribe = async () => {
      try {
        setLoading(true);
        const resolvedId = projectIdOrSlug;
        setRealProjectId(resolvedId);

        // Subscribe to Stream
        if (options.subscribe) {
          streamRef = ref(rtdb, `projects/${resolvedId}/stream`);
          streamListener = onValue(streamRef, (snapshot) => {
            if (!mounted) return;
            setStreamData(snapshot.val());
          }, (err) => {
            console.error("Stream subscription error:", err);
            if (mounted) setError(err.message);
          });
        }

      } catch (err: any) {
        console.error("Error in useProjectStream:", err);
        if (mounted) setError(err.message || "Unknown error");
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
