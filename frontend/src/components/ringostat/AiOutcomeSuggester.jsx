/**
 * AI Outcome Suggester
 * 
 * Shows AI-powered outcome suggestion based on call analysis
 * Appears in Outcome Panel after CALL_END
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, CheckCircle, Loader2 } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

export const AiOutcomeSuggester = ({ callId, onSuggestionAccept }) => {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    if (callId) {
      loadAiAnalysis();
    }
  }, [callId]);

  const loadAiAnalysis = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      // Try to get existing analysis
      let res = await fetch(`${BACKEND_URL}/api/ai/call-analysis/${callId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      let data = await res.json();
      
      // If no analysis exists, trigger it
      if (!data.success || !data.ai_analysis) {
        res = await fetch(`${BACKEND_URL}/api/ai/analyze-call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ call_id: callId })
        });
        
        data = await res.json();
      }
      
      if (data.ai_analysis) {
        setAnalysis(data.ai_analysis);
      }
    } catch (error) {
      console.error('Failed to load AI analysis:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    if (analysis && onSuggestionAccept) {
      onSuggestionAccept(analysis.suggested_outcome, analysis.next_action);
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-50 border-green-200';
    if (confidence >= 0.6) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

  const getOutcomeLabel = (outcome) => {
    const labels = {
      'interested': 'Зацікавлений',
      'callback': 'Перезвонити',
      'ready_deposit': 'Готовий до застави',
      'vin_request': 'Запит VIN',
      'next_step': 'Наступний крок',
      'reject': 'Відмова'
    };
    return labels[outcome] || outcome;
  };

  if (loading) {
    return (
      <Card className="border-2 border-blue-200 bg-blue-50" data-testid="ai-suggester-loading">
        <CardContent className="pt-6 flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
          <span className="text-sm text-blue-700">AI аналізує дзвінок...</span>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return null;
  }

  return (
    <Card 
      className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50" 
      data-testid="ai-suggester"
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-purple-700">
          <Sparkles className="h-5 w-5" />
          🤖 AI Рекомендація
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Suggested Outcome */}
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="font-semibold text-lg">{getOutcomeLabel(analysis.suggested_outcome)}</span>
          <Badge className={`ml-auto ${getConfidenceColor(analysis.confidence)} border`}>
            {Math.round(analysis.confidence * 100)}%
          </Badge>
        </div>

        {/* Intent & Objection */}
        <div className="text-sm space-y-1">
          {analysis.intent && (
            <div>
              <span className="text-muted-foreground">Намір:</span>{' '}
              <span className="font-medium">{analysis.intent === 'buy' ? 'Купити' : analysis.intent}</span>
            </div>
          )}
          {analysis.objection && (
            <div>
              <span className="text-muted-foreground">Заперечення:</span>{' '}
              <span className="font-medium text-amber-700">{analysis.objection}</span>
            </div>
          )}
        </div>

        {/* Next Action */}
        {analysis.next_action && (
          <div className="text-sm bg-white/60 rounded p-2 border border-purple-100">
            <span className="text-muted-foreground">Наступна дія:</span>{' '}
            <span className="font-medium">{analysis.next_action}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button 
            className="flex-1 bg-purple-600 hover:bg-purple-700"
            onClick={handleAccept}
            data-testid="btn-accept-ai-suggestion"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Підтвердити
          </Button>
          <Button 
            variant="outline" 
            className="flex-1"
            onClick={() => {/* Close or ignore */}}
            data-testid="btn-ignore-ai-suggestion"
          >
            Змінити
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default AiOutcomeSuggester;
