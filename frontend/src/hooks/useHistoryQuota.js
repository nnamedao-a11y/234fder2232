/**
 * useHistoryQuota Hook
 */

import { useEffect, useState, useCallback } from 'react';
import { userEngagementApi } from '../lib/api';

export function useHistoryQuota() {
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await userEngagementApi.history.getQuota();
      setQuota(data);
    } catch (err) {
      console.error('Quota load error:', err);
      setQuota(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const freeRemaining = quota?.freeRemaining ?? 0;
  const isRestricted = quota?.isRestricted ?? false;
  const canRequest = freeRemaining > 0 && !isRestricted;

  return { 
    quota, 
    loading, 
    reload: load,
    freeRemaining,
    isRestricted,
    canRequest,
  };
}

export default useHistoryQuota;
