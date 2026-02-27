import { useState, useEffect } from 'react';
import { db, rtdb } from '../firebase';
import { ref, onValue, off } from 'firebase/database';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

export const useProjectStream = (projectIdOrSlug: string | undefined, options: { subscribe?: boolean } = { subscribe: true }) => {
  const [realProjectId, setRealProjectId] = useState<string | null>(null);
  const [projectData, setProjectData] = useState<any>(null);
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
        let resolvedId = projectIdOrSlug;
        let data: any = null;

        // 1. Try as direct ID first
        const docRef = doc(db, 'projects', projectIdOrSlug);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          resolvedId = projectIdOrSlug;
          data = docSnap.data();
        } else {
          // 2. Try as slug
          const q = query(collection(db, 'projects'), where('slug', '==', projectIdOrSlug));
          const querySnap = await getDocs(q);
          
          if (!querySnap.empty) {
            const firstDoc = querySnap.docs[0];
            resolvedId = firstDoc.id;
            data = firstDoc.data();
          } else {
            // Not found
            if (mounted) {
               // If not found, we treat it as if the ID is valid but has no data, 
               // OR we can error out. The requirement says:
               // "If not found? -> slug ... found? -> real ID"
               // It doesn't explicitly say what to do if BOTH fail.
               // We will assume resolvedId remains projectIdOrSlug (and thus empty stream)
               // but projectData will be null.
               console.warn(`Project not found for ${projectIdOrSlug}`);
            }
          }
        }

        if (!mounted) return;

        setRealProjectId(resolvedId);
        setProjectData(data);

        // 3. Subscribe to Realtime Database with Real ID (if requested)
        if (options.subscribe) {
          streamRef = ref(rtdb, `sessions/${resolvedId}/stream`);
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

  return { realProjectId, projectData, streamData, loading, error };
};
