/**
 * Auction Timer Component
 * 
 * Живий таймер до аукціону
 */

import React, { useState, useEffect } from 'react';
import { Timer } from '@phosphor-icons/react';

const AuctionTimer = ({ date }) => {
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    const calculateTime = () => {
      const diff = new Date(date).getTime() - Date.now();

      if (diff <= 0) {
        setTimeLeft('Аукціон розпочато');
        setIsUrgent(false);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      setIsUrgent(diff < 24 * 60 * 60 * 1000); // Less than 24 hours

      if (days > 0) {
        setTimeLeft(`${days}д ${hours}г ${minutes}хв`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}г ${minutes}хв ${seconds}с`);
      } else {
        setTimeLeft(`${minutes}хв ${seconds}с`);
      }
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [date]);

  return (
    <div 
      className={`flex items-center gap-1.5 text-sm font-medium ${
        isUrgent ? 'text-red-500' : 'text-orange-500'
      }`}
      data-testid="auction-timer"
    >
      <Timer size={16} weight="fill" className={isUrgent ? 'animate-pulse' : ''} />
      <span>{timeLeft}</span>
    </div>
  );
};

export default AuctionTimer;
