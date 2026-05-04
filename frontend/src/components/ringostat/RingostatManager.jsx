/**
 * Ringostat Real-time Manager
 * 
 * Handles real-time call events and shows:
 * 1. Toast notifications for incoming calls
 * 2. Slide-in panel with lead/deal context
 * 3. Outcome form after call ends
 */

import React, { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneIncoming, PhoneOff, User, Building2, Clock, Thermometer } from 'lucide-react';
import { toast } from 'sonner';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useMissedCallAlerts } from '@/hooks/useMissedCallAlerts';
import OutcomeRequiredBanner from './OutcomeRequiredBanner';
import AiOutcomeSuggester from './AiOutcomeSuggester';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const RingostatManager = () => {
  const { subscribe } = useWebSocket();
  const { missedCallCount } = useMissedCallAlerts(); // Enable aggressive alerts
  const [incomingCall, setIncomingCall] = useState(null);
  const [showIncomingPanel, setShowIncomingPanel] = useState(false);
  const [showOutcomePanel, setShowOutcomePanel] = useState(false);
  const [outcomeCall, setOutcomeCall] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [callsWithoutOutcome, setCallsWithoutOutcome] = useState([]);

  useEffect(() => {
    // Subscribe to Ringostat events
    const unsubscribeIncoming = subscribe('ringostat:incoming_call', handleIncomingCall);
    const unsubscribeNeedsOutcome = subscribe('ringostat:call_needs_outcome', handleCallNeedsOutcome);
    const unsubscribeMissed = subscribe('ringostat:missed_call', handleMissedCall);

    // Load calls without outcome periodically
    loadCallsWithoutOutcome();
    const interval = setInterval(loadCallsWithoutOutcome, 30000); // Check every 30s

    return () => {
      unsubscribeIncoming();
      unsubscribeNeedsOutcome();
      unsubscribeMissed();
      clearInterval(interval);
    };
  }, [subscribe]);

  const handleIncomingCall = (data) => {
    console.log('[RINGOSTAT] Incoming call:', data);
    
    // Check if there's already an active call
    if (incomingCall && showIncomingPanel) {
      // Show "Another incoming call" toast
      toast.warning(
        <div className="flex items-center gap-3">
          <PhoneIncoming className="h-6 w-6 text-amber-600 animate-bounce" />
          <div>
            <div className="font-bold text-base">⚠️ Другий вхідний дзвінок!</div>
            <div className="text-sm font-medium">{data.lead_name || data.from}</div>
            <div className="text-xs text-muted-foreground mt-1">Перший дзвінок ще активний</div>
          </div>
        </div>,
        {
          duration: 15000,
          position: 'bottom-right',
          className: 'border-2 border-amber-500',
          action: {
            label: 'Прийняти',
            onClick: () => {
              setIncomingCall(data);
              openIncomingPanel(data);
            }
          }
        }
      );
      return;
    }
    
    setIncomingCall(data);
    
    // Show prominent toast with sound/vibration effect
    toast(
      <div 
        className="flex items-center gap-3 cursor-pointer p-2" 
        onClick={() => openIncomingPanel(data)}
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100 animate-pulse">
          <PhoneIncoming className="h-6 w-6 text-green-600" />
        </div>
        <div>
          <div className="font-bold text-base">🔔 Вхідний дзвінок!</div>
          <div className="text-sm font-medium">{data.lead_name || data.from}</div>
          <div className="text-xs text-muted-foreground">Клікніть щоб відкрити</div>
        </div>
      </div>,
      {
        duration: 15000,
        position: 'top-right',
        className: 'border-2 border-green-500 shadow-xl',
        important: true
      }
    );

    // Auto-open panel after 2 seconds if not clicked
    setTimeout(() => {
      if (!showIncomingPanel) {
        openIncomingPanel(data);
      }
    }, 2000);
  };

  const handleCallNeedsOutcome = (data) => {
    console.log('[RINGOSTAT] Call needs outcome:', data);
    setOutcomeCall(data);
    setShowOutcomePanel(true);
    
    toast.info('Дзвінок завершено. Вкажіть результат.', {
      duration: 5000
    });
  };

  const handleMissedCall = (data) => {
    console.log('[RINGOSTAT] Missed call:', data);
    
    toast.error(
      <div className="flex items-center gap-3">
        <PhoneOff className="h-5 w-5 text-red-600" />
        <div>
          <div className="font-semibold">Пропущений дзвінок</div>
          <div className="text-sm">{data.lead_name || data.from}</div>
          <div className="text-xs text-muted-foreground">Створено задачу</div>
        </div>
      </div>,
      {
        duration: 8000
      }
    );
  };

  const openIncomingPanel = (data) => {
    setIncomingCall(data);
    setShowIncomingPanel(true);
  };

  const handleSaveOutcome = async () => {
    if (!outcome || !outcomeNote) {
      toast.error('Вкажіть результат та коментар');
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/manager/calls/${outcomeCall.call_id}/outcome`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          outcome,
          outcome_note: outcomeNote,
          callback_at: callbackAt || null
        })
      });

      if (res.ok) {
        toast.success('Результат дзвінку збережено');
        setShowOutcomePanel(false);
        setOutcome('');
        setOutcomeNote('');
        setCallbackAt('');
        // Reload calls without outcome
        loadCallsWithoutOutcome();
      } else {
        toast.error('Помилка збереження');
      }
    } catch (error) {
      toast.error('Помилка з\'єднання');
    }
  };

  const loadCallsWithoutOutcome = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const res = await fetch(`${BACKEND_URL}/api/manager/calls/my?limit=50`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (data.calls) {
        // Filter calls that need outcome (duration > 30s, answered, no outcome)
        const needsOutcome = data.calls.filter(call => 
          !call.outcome && 
          call.duration > 30 && 
          call.status === 'ANSWERED'
        );
        setCallsWithoutOutcome(needsOutcome);
      }
    } catch (error) {
      console.error('Failed to load calls without outcome:', error);
    }
  };

  const handleFillOutcomeFromBanner = (call) => {
    setOutcomeCall(call);
    setShowOutcomePanel(true);
  };


  const getTemperatureColor = (temp) => {
    if (temp >= 80) return 'text-red-600';
    if (temp >= 50) return 'text-orange-600';
    if (temp >= 30) return 'text-yellow-600';
    return 'text-blue-600';
  };

  const getTemperatureLabel = (temp) => {
    if (temp >= 80) return '🔥 Гарячий';
    if (temp >= 50) return '🟡 Теплий';
    if (temp >= 30) return '🟢 Прохолодний';
    return '❄️ Холодний';
  };

  return (
    <>
      {/* Incoming Call Panel */}
      <Sheet open={showIncomingPanel} onOpenChange={setShowIncomingPanel}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PhoneIncoming className="h-5 w-5 text-green-600" />
              Вхідний дзвінок
            </SheetTitle>
            <SheetDescription>Контекст ліда та угоди</SheetDescription>
          </SheetHeader>

          {incomingCall && (
            <div className="mt-6 space-y-4">
              {/* Phone */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Телефон</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-lg font-semibold">{incomingCall.from}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Lead Info */}
              {incomingCall.lead_name && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Лід</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{incomingCall.lead_name}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">{incomingCall.lead_phone}</div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Deal Info */}
              {incomingCall.deal_title && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Угода</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{incomingCall.deal_title}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Source */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Джерело</CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge>{incomingCall.source || 'ringostat'}</Badge>
                </CardContent>
              </Card>

              {/* Temperature (if available) */}
              {incomingCall.temperature !== undefined && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Температура</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Thermometer className={`h-4 w-4 ${getTemperatureColor(incomingCall.temperature)}`} />
                      <span className={`font-semibold ${getTemperatureColor(incomingCall.temperature)}`}>
                        {getTemperatureLabel(incomingCall.temperature)}
                      </span>
                      <span className="text-sm text-muted-foreground">({incomingCall.temperature}/100)</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-4">
                {incomingCall.lead_id && (
                  <>
                    <Button 
                      className="flex-1"
                      onClick={() => {
                        window.location.href = `/admin/leads?id=${incomingCall.lead_id}`;
                      }}
                      data-testid="btn-open-lead"
                    >
                      Відкрити лід
                    </Button>
                    {incomingCall.deal_id && (
                      <Button 
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          window.location.href = `/admin/legal?tab=deal_pipeline&dealId=${incomingCall.deal_id}`;
                        }}
                        data-testid="btn-open-deal"
                      >
                        Відкрити угоду
                      </Button>
                    )}
                  </>
                )}
                {!incomingCall.lead_id && (
                  <Button 
                    className="flex-1"
                    onClick={() => {
                      // Create new lead with this phone number
                      window.location.href = `/admin/leads?create=true&phone=${incomingCall.from}`;
                    }}
                    data-testid="btn-create-lead"
                  >
                    Створити лід
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Call Outcome Panel */}
      <Sheet open={showOutcomePanel} onOpenChange={setShowOutcomePanel}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Результат дзвінку
            </SheetTitle>
            <SheetDescription>Вкажіть результат розмови з клієнтом</SheetDescription>
          </SheetHeader>

          {outcomeCall && (
            <div className="mt-6 space-y-4">
              {/* Call Info */}
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Телефон: </span>
                      <span className="font-semibold">{outcomeCall.from}</span>
                    </div>
                    {outcomeCall.lead_name && (
                      <div>
                        <span className="text-muted-foreground">Лід: </span>
                        <span className="font-semibold">{outcomeCall.lead_name}</span>
                      </div>
                    )}
                    {outcomeCall.duration && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Тривалість: {outcomeCall.duration}с</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* AI Outcome Suggester */}
              {outcomeCall.call_id && (
                <AiOutcomeSuggester 
                  callId={outcomeCall.call_id}
                  onSuggestionAccept={(suggestedOutcome, nextAction) => {
                    setOutcome(suggestedOutcome);
                    setOutcomeNote(nextAction || '');
                  }}
                />
              )}

              {/* Outcome Selection */}
              <div className="space-y-2">
                <Label>Результат дзвінку *</Label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger>
                    <SelectValue placeholder="Оберіть результат" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interested">🚀 Зацікавлений</SelectItem>
                    <SelectItem value="callback">📞 Потрібен дзвінок</SelectItem>
                    <SelectItem value="no_answer">❌ Не відповів</SelectItem>
                    <SelectItem value="vin_request">🚗 Запит VIN</SelectItem>
                    <SelectItem value="delivery_discussion">🚚 Обговорення доставки</SelectItem>
                    <SelectItem value="ready_deposit">💰 Готовий до застави</SelectItem>
                    <SelectItem value="reject">⛔ Відмова</SelectItem>
                    <SelectItem value="next_step">➡️ Наступний крок</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Callback Time (conditional) */}
              {outcome === 'callback' && (
                <div className="space-y-2">
                  <Label>Коли передзвонити?</Label>
                  <Input
                    type="datetime-local"
                    value={callbackAt}
                    onChange={(e) => setCallbackAt(e.target.value)}
                  />
                </div>
              )}

              {/* Comment */}
              <div className="space-y-2">
                <Label>Коментар *</Label>
                <Textarea
                  value={outcomeNote}
                  onChange={(e) => setOutcomeNote(e.target.value)}
                  placeholder="Опишіть результат розмови..."
                  rows={4}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                      e.preventDefault();
                      handleSaveOutcome();
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">Ctrl+Enter для швидкого збереження</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-4">
                <Button 
                  className="flex-1"
                  onClick={handleSaveOutcome}
                  disabled={!outcome || !outcomeNote}
                >
                  Зберегти
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowOutcomePanel(false)}
                >
                  Скасувати
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Outcome Required Banner */}
      <OutcomeRequiredBanner 
        calls={callsWithoutOutcome}
        onFillOutcome={handleFillOutcomeFromBanner}
      />
    </>
  );
};

export default RingostatManager;
