/**
 * useShipmentNotifications Hook
 *
 * Real-time WebSocket for shipment updates.
 * Exposes React state only (no window events, no dispatchEvent).
 *
 * Returns:
 *   - isConnected          — socket connected?
 *   - lastUpdate           — most recent update { type, data, timestamp }
 *   - statusChanged        — shipment:status_changed payload
 *   - etaChanged           — shipment:eta_changed payload
 *   - positionUpdate       — shipment:update payload (REAL / INTERPOLATED / SIMULATED)
 *   - reconnectTimestamp   — updated on every reconnect, for consumer refetch
 *   - subscribe(id)        — subscribe to shipment room on backend
 *   - clearUpdate()
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

export function useShipmentNotifications() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [statusChanged, setStatusChanged] = useState(null);
  const [etaChanged, setEtaChanged] = useState(null);
  const [positionUpdate, setPositionUpdate] = useState(null);
  const [reconnectTimestamp, setReconnectTimestamp] = useState(0);
  const socketRef = useRef(null);
  const subscribedRef = useRef(new Set());

  useEffect(() => {
    const token =
      localStorage.getItem('token') || localStorage.getItem('customerToken');
    if (!token) {
      return;
    }

    const socket = io(`${BACKEND_URL}/notifications`, {
      query: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      setReconnectTimestamp(Date.now());
      // re-subscribe to all shipments we were tracking
      subscribedRef.current.forEach((id) => {
        socket.emit('subscribe:shipment', { shipmentId: id });
      });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('shipment:status_changed', (data) => {
      setStatusChanged(data);
      setLastUpdate({ type: 'status', data, timestamp: new Date() });
    });

    socket.on('shipment:eta_changed', (data) => {
      setEtaChanged(data);
      setLastUpdate({ type: 'eta', data, timestamp: new Date() });
    });

    socket.on('shipment:arrived', (data) => {
      setLastUpdate({ type: 'arrived', data, timestamp: new Date() });
    });

    // Live position updates from tracking worker — REAL / INTERPOLATED / SIMULATED
    socket.on('shipment:update', (data) => {
      setPositionUpdate(data);
      setLastUpdate({ type: 'position', data, timestamp: new Date() });
      // Phase D — auto transfer notification
      if (data?.type === 'vessel_transferred') {
        try {
          const toName = data?.to?.name || 'нове судно';
          // eslint-disable-next-line global-require
          const { toast } = require('sonner');
          toast?.info?.(`🚢 Перевалку виявлено: ${toName}`, {
            description: 'Контейнер перевантажено — маршрут оновлено автоматично.',
            duration: 7000,
          });
        } catch {}
      }
    });

    // Legacy channel compatibility
    socket.on('shipment:position_updated', (data) => {
      const normalized = {
        shipmentId: data.shipmentId,
        currentPosition: data.position || data.currentPosition,
        progress: data.progress,
        location: data.location,
        type: data.source || 'simulated',
      };
      setPositionUpdate(normalized);
      setLastUpdate({ type: 'position', data: normalized, timestamp: new Date() });
    });

    socket.on('shipment:ready_for_pickup', (data) => {
      setLastUpdate({ type: 'ready', data, timestamp: new Date() });
    });

    socket.on('notification', (data) => {
      setLastUpdate({ type: 'notification', data, timestamp: new Date() });
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  const subscribe = useCallback((shipmentId) => {
    if (!shipmentId) return;
    subscribedRef.current.add(shipmentId);
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe:shipment', { shipmentId });
    }
  }, []);

  const clearUpdate = useCallback(() => {
    setLastUpdate(null);
    setStatusChanged(null);
    setEtaChanged(null);
    setPositionUpdate(null);
  }, []);

  return {
    isConnected,
    lastUpdate,
    statusChanged,
    etaChanged,
    positionUpdate,
    reconnectTimestamp,
    subscribe,
    clearUpdate,
  };
}

export default useShipmentNotifications;
