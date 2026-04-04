import { useEffect, useRef } from 'react';
import { useFlightStore } from '../stores/flightStore';
import type { WSMessage } from '../types/flight';

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedSnapshot = useRef(false);
  const retriesRef = useRef(0);
  const { setFlights, removeFlights, setStats, setConnectionStatus } = useFlightStore();

  useEffect(() => {
    let mounted = true;

    async function loadSnapshot() {
      try {
        const [flightsRes, statsRes] = await Promise.all([
          fetch('/api/flights'),
          fetch('/api/stats'),
        ]);

        if (!mounted) return;

        if (flightsRes.ok) {
          const flightsPayload = await flightsRes.json();
          if (Array.isArray(flightsPayload.ac) && flightsPayload.ac.length > 0) {
            setFlights(flightsPayload.ac);
            hasLoadedSnapshot.current = true;
          }
        }

        if (statsRes.ok) {
          const statsPayload = await statsRes.json();
          setStats(statsPayload);
        }
      } catch {
        // Ignore bootstrap fetch failures; websocket remains primary.
      }
    }

    async function bootstrapUntilLive() {
      await loadSnapshot();

      if (!mounted) return;

      const wsConnected = wsRef.current?.readyState === WebSocket.OPEN;
      if (!hasLoadedSnapshot.current || !wsConnected) {
        bootstrapTimer.current = setTimeout(() => {
          void bootstrapUntilLive();
        }, 1500);
      }
    }

    function connect() {
      if (!mounted) return;
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      
      setConnectionStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        retriesRef.current = 0;
        setConnectionStatus('connected');
        void loadSnapshot();
        console.log('[ws] Connected');
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const msg: WSMessage = JSON.parse(event.data);
          switch (msg.type) {
            case 'flight-update':
              if (msg.data.length > 0) {
                hasLoadedSnapshot.current = true;
              }
              setFlights(msg.data);
              break;
            case 'flight-remove':
              removeFlights(msg.data);
              break;
            case 'stats':
              setStats(msg.data);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        setConnectionStatus('disconnected');
        retriesRef.current += 1;
        const jitter = Math.random() * 500;
        const delay = Math.min(BACKOFF_BASE * Math.pow(2, retriesRef.current - 1), BACKOFF_MAX) + jitter;
        console.log(`[ws] Disconnected, reconnecting in ${Math.round(delay)}ms (attempt ${retriesRef.current})`);
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    void bootstrapUntilLive();
    connect();

    return () => {
      mounted = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (bootstrapTimer.current) {
        clearTimeout(bootstrapTimer.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [setFlights, removeFlights, setStats, setConnectionStatus]);
}
