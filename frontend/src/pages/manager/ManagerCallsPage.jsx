/**
 * Manager Calls Page
 * 
 * Полноценный call workspace для менеджера BIBI Cars:
 * - Summary cards (calls today, answered, missed, need callback, avg duration, conversion)
 * - Filters (date, direction, status, outcome)
 * - Tabs (Все, Live, Missed, Need Callback, Recordings, My Outcomes)
 * - Таблица звонков
 * - Call Details Drawer
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { 
  Phone, 
  PhoneIncoming, 
  PhoneOutgoing, 
  PhoneMissed, 
  Clock, 
  TrendingUp,
  PlayCircle,
  Eye,
  Calendar
} from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const ManagerCallsPage = () => {
  const [activeTab, setActiveTab] = useState('all');
  const [calls, setCalls] = useState([]);
  const [selectedCall, setSelectedCall] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Summary stats
  const [stats, setStats] = useState({
    calls_today: 0,
    answered: 0,
    missed: 0,
    need_callback: 0,
    avg_duration: 0,
    conversion: 0
  });

  // Filters
  const [filters, setFilters] = useState({
    period: 'today',
    status: null,
    direction: null,
    outcome: null
  });

  useEffect(() => {
    loadCalls();
    loadStats();
  }, [activeTab, filters]);

  const loadCalls = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      let endpoint = `${BACKEND_URL}/api/manager/calls/my?limit=50`;
      
      // Apply filters based on active tab
      if (activeTab === 'missed') {
        endpoint = `${BACKEND_URL}/api/manager/calls/missed`;
      } else if (activeTab === 'live') {
        endpoint += '&status=IN_PROGRESS';
      }

      const res = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await res.json();
      setCalls(data.calls || []);
    } catch (error) {
      console.error('Failed to load calls:', error);
      toast.error('Помилка завантаження дзвінків');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      // Mock stats for now - can be implemented via backend endpoint later
      setStats({
        calls_today: calls.length,
        answered: calls.filter(c => c.status === 'ANSWERED').length,
        missed: calls.filter(c => c.status === 'MISSED').length,
        need_callback: calls.filter(c => c.outcome === 'callback').length,
        avg_duration: Math.round(calls.reduce((acc, c) => acc + (c.duration || 0), 0) / calls.length) || 0,
        conversion: 0
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  useEffect(() => {
    loadStats();
  }, [calls]);

  const getStatusBadge = (status) => {
    const statusMap = {
      'ANSWERED': { color: 'bg-green-50 text-green-700 border-green-200', label: 'Відповів' },
      'MISSED': { color: 'bg-red-50 text-red-700 border-red-200', label: 'Пропущено' },
      'NO_ANSWER': { color: 'bg-gray-50 text-gray-700 border-gray-200', label: 'Не відповів' },
      'IN_PROGRESS': { color: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Активний' },
      'CALL_RINGING': { color: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Дзвонить' }
    };
    
    const config = statusMap[status] || { color: 'bg-gray-50 text-gray-700 border-gray-200', label: status };
    return (
      <Badge className={`${config.color} border`} data-testid={`call-status-${status}`}>
        {config.label}
      </Badge>
    );
  };

  const getDirectionIcon = (direction) => {
    if (direction === 'inbound') return <PhoneIncoming className="h-4 w-4 text-green-600" data-testid="direction-inbound" />;
    return <PhoneOutgoing className="h-4 w-4 text-blue-600" data-testid="direction-outbound" />;
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6" data-testid="manager-calls-page">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="page-title">Мої дзвінки</h1>
        <p className="text-muted-foreground mt-1">Управління дзвінками та робоча черга</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card data-testid="stat-calls-today">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              Сьогодні
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.calls_today}</div>
            <p className="text-xs text-muted-foreground mt-1">дзвінків</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-answered">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <PhoneIncoming className="h-4 w-4 text-green-600" />
              Відповів
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.answered}</div>
            <p className="text-xs text-muted-foreground mt-1">з {stats.calls_today}</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-missed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <PhoneMissed className="h-4 w-4 text-red-600" />
              Пропущено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.missed}</div>
            <p className="text-xs text-muted-foreground mt-1">потребує дії</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-callback">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber-600" />
              Callback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.need_callback}</div>
            <p className="text-xs text-muted-foreground mt-1">в черзі</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-duration">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Середня
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(stats.avg_duration)}</div>
            <p className="text-xs text-muted-foreground mt-1">тривалість</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-conversion">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Конверсія
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.conversion}%</div>
            <p className="text-xs text-muted-foreground mt-1">після дзвінка</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="calls-tabs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">Всі</TabsTrigger>
            <TabsTrigger value="live" data-testid="tab-live">Live</TabsTrigger>
            <TabsTrigger value="missed" data-testid="tab-missed">
              Пропущені
              {stats.missed > 0 && (
                <Badge className="ml-2 bg-red-600 text-white">{stats.missed}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="callbacks" data-testid="tab-callbacks">
              Need Callback
              {stats.need_callback > 0 && (
                <Badge className="ml-2 bg-amber-600 text-white">{stats.need_callback}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="recordings" data-testid="tab-recordings">Записи</TabsTrigger>
            <TabsTrigger value="outcomes" data-testid="tab-outcomes">Мої результати</TabsTrigger>
          </TabsList>

          {/* Filters */}
          <div className="flex gap-2">
            <Select value={filters.period} onValueChange={(v) => setFilters({ ...filters, period: v })}>
              <SelectTrigger className="w-[140px]" data-testid="filter-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Сьогодні</SelectItem>
                <SelectItem value="week">Тиждень</SelectItem>
                <SelectItem value="month">Місяць</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.status || 'all'} onValueChange={(v) => setFilters({ ...filters, status: v === 'all' ? null : v })}>
              <SelectTrigger className="w-[150px]" data-testid="filter-status">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі статуси</SelectItem>
                <SelectItem value="ANSWERED">Відповів</SelectItem>
                <SelectItem value="MISSED">Пропущено</SelectItem>
                <SelectItem value="NO_ANSWER">Не відповів</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.direction || 'all'} onValueChange={(v) => setFilters({ ...filters, direction: v === 'all' ? null : v })}>
              <SelectTrigger className="w-[150px]" data-testid="filter-direction">
                <SelectValue placeholder="Напрямок" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі</SelectItem>
                <SelectItem value="inbound">Вхідні</SelectItem>
                <SelectItem value="outbound">Вихідні</SelectItem>
              </SelectContent>
            </Select>

            <Button onClick={loadCalls} variant="outline" data-testid="btn-refresh">
              Оновити
            </Button>
          </div>
        </div>

        {/* Calls Table */}
        <TabsContent value={activeTab} className="mt-0">
          <Card>
            <CardContent className="pt-6">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Завантаження...</div>
              ) : calls.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground" data-testid="empty-state">
                  Дзвінків немає
                </div>
              ) : (
                <Table data-testid="calls-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Час</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead>Контакт</TableHead>
                      <TableHead>Напрямок</TableHead>
                      <TableHead>Тривалість</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Deal</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Дії</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((call) => (
                      <TableRow key={call._id} data-testid={`call-row-${call._id}`}>
                        <TableCell className="font-mono text-sm">
                          {new Date(call.started_at || call.created_at).toLocaleTimeString('uk-UA', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </TableCell>
                        <TableCell className="font-medium">{call.from}</TableCell>
                        <TableCell>
                          {call.lead ? (
                            <div>
                              <div className="font-medium">{call.lead.name}</div>
                              <div className="text-sm text-muted-foreground">{call.lead.phone}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Unknown</span>
                          )}
                        </TableCell>
                        <TableCell>{getDirectionIcon(call.direction)}</TableCell>
                        <TableCell>{formatDuration(call.duration)}</TableCell>
                        <TableCell>{getStatusBadge(call.status)}</TableCell>
                        <TableCell>
                          {call.lead ? (
                            <Button
                              variant="link"
                              size="sm"
                              className="p-0 h-auto"
                              onClick={() => window.location.href = `/admin/leads?id=${call.lead.id}`}
                              data-testid={`btn-open-lead-${call._id}`}
                            >
                              {call.lead.name}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {call.deal ? (
                            <Button
                              variant="link"
                              size="sm"
                              className="p-0 h-auto"
                              onClick={() => window.location.href = `/admin/deals?id=${call.deal.id}`}
                              data-testid={`btn-open-deal-${call._id}`}
                            >
                              {call.deal.title}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {call.outcome ? (
                            <Badge variant="secondary">{call.outcome}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">Не заповнено</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedCall(call)}
                              data-testid={`btn-view-call-${call._id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {call.recording_url && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => window.open(call.recording_url, '_blank')}
                                data-testid={`btn-play-recording-${call._id}`}
                              >
                                <PlayCircle className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Call Details Drawer */}
      <Sheet open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <SheetContent className="w-[400px] sm:w-[540px]" data-testid="call-details-drawer">
          <SheetHeader>
            <SheetTitle>Деталі дзвінка</SheetTitle>
            <SheetDescription>Повна інформація про дзвінок</SheetDescription>
          </SheetHeader>

          {selectedCall && (
            <div className="mt-6 space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Call ID</div>
                      <div className="font-mono font-medium">{selectedCall.call_id || selectedCall._id}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Час</div>
                      <div className="font-medium">
                        {new Date(selectedCall.started_at || selectedCall.created_at).toLocaleString('uk-UA')}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Напрямок</div>
                      <div>{getDirectionIcon(selectedCall.direction)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Тривалість</div>
                      <div className="font-medium">{formatDuration(selectedCall.duration)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Телефон</div>
                      <div className="font-medium">{selectedCall.from}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Статус</div>
                      <div>{getStatusBadge(selectedCall.status)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {selectedCall.lead && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Lead</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      <div className="font-semibold">{selectedCall.lead.name}</div>
                      <div className="text-sm text-muted-foreground">{selectedCall.lead.phone}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => window.location.href = `/admin/leads?id=${selectedCall.lead.id}`}
                      >
                        Відкрити лід
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedCall.outcome && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Результат</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <Badge>{selectedCall.outcome}</Badge>
                      {selectedCall.outcome_note && (
                        <p className="text-sm text-muted-foreground mt-2">{selectedCall.outcome_note}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedCall.recording_url && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Запис</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button
                      className="w-full"
                      onClick={() => window.open(selectedCall.recording_url, '_blank')}
                    >
                      <PlayCircle className="h-4 w-4 mr-2" />
                      Прослухати запис
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ManagerCallsPage;
