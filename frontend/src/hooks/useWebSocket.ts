import { useEffect, useRef } from 'react';
import { useFlightStore } from '../stores/flightStore';
import type { WSMessage } from '../types/flight';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const { setFlights, removeFlights, setStats, setConnectionStatus } = useFlightStore();

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      
      setConnectionStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        setConnectionStatus('connected');
        console.log('[ws] Connected');
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const msg: WSMessage = JSON.parse(event.data);
          switch (msg.type) {
            case 'flight-update':
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
        console.log('[ws] Disconnected, reconnecting in 3s...');
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      mounted = false;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [setFlights, removeFlights, setStats, setConnectionStatus]);
}
