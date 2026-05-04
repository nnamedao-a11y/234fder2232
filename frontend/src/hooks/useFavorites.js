/**
 * useFavorites Hook
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { userEngagementApi } from '../lib/api';

export function useFavorites() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await userEngagementApi.favorites.getMine();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Favorites load error:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(async (vehicle) => {
    await userEngagementApi.favorites.add(vehicle);
    await load();
  }, [load]);

  const remove = useCallback(async (vehicleId) => {
    await userEngagementApi.favorites.remove(vehicleId);
    await load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const vinSet = useMemo(() => new Set(items.map((x) => x.vin)), [items]);
  const vehicleSet = useMemo(() => new Set(items.map((x) => x.vehicleId)), [items]);

  return {
    items,
    loading,
    reload: load,
    add,
    remove,
    vinSet,
    vehicleSet,
  };
}

export default useFavorites;
