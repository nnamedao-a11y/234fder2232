/**
 * Outcome Required Banner
 * 
 * Persistent banner для звонков > 30s без outcome
 * Блокирует navigation и требует заполнения результата
 */

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export const OutcomeRequiredBanner = ({ calls, onFillOutcome }) => {
  const callsNeedingOutcome = calls.filter(call => 
    !call.outcome && 
    call.duration > 30 && 
    call.status === 'ANSWERED'
  );

  if (callsNeedingOutcome.length === 0) return null;

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-red-600 text-white shadow-2xl animate-pulse"
      data-testid="outcome-required-banner"
    >
      <div className="container mx-auto max-w-4xl">
        <Alert className="border-0 bg-red-700 text-white">
          <AlertCircle className="h-5 w-5 text-white" />
          <AlertTitle className="text-lg font-bold">
            ⚠️ Заповніть результат дзвінка!
          </AlertTitle>
          <AlertDescription className="mt-2 flex items-center justify-between">
            <div>
              <p className="text-sm">
                У вас {callsNeedingOutcome.length} дзвінків без результату (тривалість &gt; 30 сек)
              </p>
              <p className="text-xs text-red-200 mt-1">
                Заповнення обов'язкове для всіх розмов
              </p>
            </div>
            <Button 
              variant="secondary" 
              size="lg"
              onClick={() => onFillOutcome(callsNeedingOutcome[0])}
              className="ml-4 bg-white text-red-600 hover:bg-red-50 font-bold"
              data-testid="btn-fill-outcome"
            >
              Заповнити зараз
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
};

export default OutcomeRequiredBanner;
