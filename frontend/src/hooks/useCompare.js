/**
 * useCompare Hook
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { userEngagementApi } from '../lib/api';

export function useCompare() {
  const [list, setList] = useState(null);
  const [resolved, setResolved] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const mine = await userEngagementApi.compare.getMine();
      setList(mine || null);

      if (mine?.items?.length) {
        const data = await userEngagementApi.compare.resolve();
        setResolved(data?.comparison || []);
      } else {
        setResolved([]);
      }
    } catch (err) {
      console.error('Compare load error:', err);
      setList(null);
      setResolved([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(async (vehicle) => {
    await userEngagementApi.compare.add(vehicle);
    await load();
  }, [load]);

  const remove = useCallback(async (vehicleId) => {
    await userEngagementApi.compare.remove(vehicleId);
    await load();
  }, [load]);

  const clear = useCallback(async () => {
    await userEngagementApi.compare.clear();
    await load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const vehicleSet = useMemo(
    () => new Set(list?.items?.map((x) => x.vehicleId) || []),
    [list],
  );

  const count = list?.items?.length || 0;

  return {
    list,
    resolved,
    loading,
    reload: load,
    add,
    remove,
    clear,
    vehicleSet,
    count,
    isFull: count >= 3,
  };
}

export default useCompare;
