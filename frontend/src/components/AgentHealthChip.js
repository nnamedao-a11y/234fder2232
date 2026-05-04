/**
 * AgentHealthChip Component
 * Индикатор состояния Chrome Extension агента
 */

import React, { useState, useEffect } from 'react';
import { Activity, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { API_URL } from '../App';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

export const AgentHealthChip = () => {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAgentHealth();
    const interval = setInterval(checkAgentHealth, 15000); // Проверка каждые 15 сек
    return () => clearInterval(interval);
  }, []);

  const checkAgentHealth = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/agent/ping`);
      setHealth(res.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to check agent health:', error);
      setHealth({ alive: false, message: 'Ошибка проверки' });
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground">
        <div className="w-2 h-2 rounded-full bg-zinc-400 animate-pulse" />
        <span className="text-xs font-medium">Проверка...</span>
      </div>
    );
  }

  const isAlive = health?.alive;
  const Icon = isAlive ? Activity : AlertCircle;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="agent-health-chip"
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full cursor-help transition-colors ${
              isAlive
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
            }`}
          >
            {isAlive ? (
              <span
                className="relative inline-flex h-2 w-2 rounded-full bg-green-500"
                aria-hidden="true"
              >
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              </span>
            ) : (
              <span className="inline-flex h-2 w-2 rounded-full bg-red-500" aria-hidden="true"></span>
            )}
            <Icon size={14} weight="bold" />
            <span className="text-xs font-medium">{isAlive ? 'Агент активен' : 'Агент не отвечает'}</span>
            {health?.lastHeartbeat && isAlive && (
              <span data-testid="agent-health-last-seen" className="text-xs text-muted-foreground ml-1">
                ({Math.floor(health.staleSeconds || 0)}с)
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-2">
            <p className="font-medium">{health?.message}</p>
            {!isAlive && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Чтобы исправить:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Откройте Chrome Extensions (chrome://extensions/)</li>
                  <li>Убедитесь, что BIBI Cars Parser включен</li>
                  <li>Перезагрузите расширение если нужно</li>
                </ol>
              </div>
            )}
            {isAlive && health?.lastHeartbeat && (
              <p className="text-xs text-muted-foreground">
                Последний отклик: {new Date(health.lastHeartbeat).toLocaleTimeString('ru-RU')}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
