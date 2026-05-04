/**
 * Missed Calls Board
 * 
 * Операционная доска пропущенных звонков по срочности:
 * - RED: 0-5 минут (URGENT)
 * - ORANGE: 5-30 минут (HIGH)
 * - YELLOW: 30+ минут (DELAYED)
 * 
 * Действия: [Call back] [Open lead] [Mark handled]
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  PhoneMissed, 
  Phone, 
  Eye, 
  CheckCircle,
  AlertCircle,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const MissedCallsBoard = () => {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMissedCalls();
    const interval = setInterval(loadMissedCalls, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadMissedCalls = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BACKEND_URL}/api/manager/calls/missed`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await res.json();
      setCalls(data.calls || []);
    } catch (error) {
      console.error('Failed to load missed calls:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMinutesSinceMissed = (timestamp) => {
    const now = new Date();
    const callTime = new Date(timestamp);
    return Math.floor((now - callTime) / 1000 / 60);
  };

  const categorizeCall = (call) => {
    const minutes = getMinutesSinceMissed(call.started_at || call.created_at);
    if (minutes <= 5) return 'urgent';
    if (minutes <= 30) return 'high';
    return 'delayed';
  };

  const urgentCalls = calls.filter(c => categorizeCall(c) === 'urgent');
  const highCalls = calls.filter(c => categorizeCall(c) === 'high');
  const delayedCalls = calls.filter(c => categorizeCall(c) === 'delayed');

  const handleCallBack = (call) => {
    // Open dialer or create callback task
    toast.success(`Дзвонимо ${call.from}...`);
    window.location.href = `tel:${call.from}`;
  };

  const handleOpenLead = (call) => {
    if (call.lead_id) {
      window.location.href = `/admin/leads?id=${call.lead_id}`;
    } else {
      toast.error('Lead не знайдено');
    }
  };

  const handleMarkHandled = async (call) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`${BACKEND_URL}/api/calls/${call.call_id}/outcome`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          outcome: 'no_answer',
          note: 'Оброблено з missed board'
        })
      });
      
      toast.success('Позначено як оброблено');
      loadMissedCalls();
    } catch (error) {
      toast.error('Помилка');
    }
  };

  const renderCallCard = (call) => {
    const minutes = getMinutesSinceMissed(call.started_at || call.created_at);
    const category = categorizeCall(call);
    
    const categoryConfig = {
      urgent: { 
        bg: 'bg-red-50 border-red-200', 
        badge: 'bg-red-600 text-white',
        icon: 'text-red-600'
      },
      high: { 
        bg: 'bg-orange-50 border-orange-200', 
        badge: 'bg-orange-600 text-white',
        icon: 'text-orange-600'
      },
      delayed: { 
        bg: 'bg-yellow-50 border-yellow-200', 
        badge: 'bg-yellow-600 text-white',
        icon: 'text-yellow-600'
      }
    };
    
    const config = categoryConfig[category];

    return (
      <Card key={call._id} className={`${config.bg} border-2`} data-testid={`missed-call-${call._id}`}>
        <CardContent className="pt-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <PhoneMissed className={`h-5 w-5 ${config.icon}`} />
                <div>
                  <div className="font-bold">{call.lead_name || 'Unknown'}</div>
                  <div className="text-sm text-muted-foreground font-mono">{call.from}</div>
                </div>
              </div>
              <Badge className={config.badge}>
                <Clock className="h-3 w-3 mr-1" />
                {minutes} хв
              </Badge>
            </div>

            {/* Info */}
            {call.lead && (
              <div className="text-sm">
                <div><strong>Lead:</strong> {call.lead.name}</div>
                {call.deal && <div><strong>Deal:</strong> {call.deal.title}</div>}
              </div>
            )}

            {/* Assigned Manager */}
            {call.manager_name && (
              <div className="text-sm text-muted-foreground">
                Assigned: {call.manager_name}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button 
                size="sm" 
                className="flex-1"
                onClick={() => handleCallBack(call)}
                data-testid={`btn-callback-${call._id}`}
              >
                <Phone className="h-4 w-4 mr-1" />
                Call back
              </Button>
              {call.lead_id && (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleOpenLead(call)}
                  data-testid={`btn-open-${call._id}`}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => handleMarkHandled(call)}
                data-testid={`btn-handled-${call._id}`}
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return <div className="text-center py-8">Завантаження...</div>;
  }

  return (
    <div className="space-y-6" data-testid="missed-calls-board">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Пропущені дзвінки</h1>
          <p className="text-muted-foreground mt-1">Операційна черга по срочності</p>
        </div>
        <Button onClick={loadMissedCalls} variant="outline">
          Оновити
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700">
              <AlertCircle className="h-4 w-4" />
              Urgent (0-5 хв)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-700">{urgentCalls.length}</div>
          </CardContent>
        </Card>

        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-orange-700">
              <Clock className="h-4 w-4" />
              High (5-30 хв)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-700">{highCalls.length}</div>
          </CardContent>
        </Card>

        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-yellow-700">
              <Clock className="h-4 w-4" />
              Delayed (30+ хв)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-700">{delayedCalls.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Board */}
      {calls.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            🎉 Немає пропущених дзвінків!
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Urgent Column */}
          <div className="space-y-4">
            <h3 className="font-bold text-red-700 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Urgent (0-5 хв)
            </h3>
            {urgentCalls.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  Порожньо
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {urgentCalls.map(renderCallCard)}
              </div>
            )}
          </div>

          {/* High Column */}
          <div className="space-y-4">
            <h3 className="font-bold text-orange-700 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              High (5-30 хв)
            </h3>
            {highCalls.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  Порожньо
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {highCalls.map(renderCallCard)}
              </div>
            )}
          </div>

          {/* Delayed Column */}
          <div className="space-y-4">
            <h3 className="font-bold text-yellow-700 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Delayed (30+ хв)
            </h3>
            {delayedCalls.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  Порожньо
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {delayedCalls.map(renderCallCard)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MissedCallsBoard;
