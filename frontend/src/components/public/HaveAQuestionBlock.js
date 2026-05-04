import React from 'react';

export const HaveAQuestionBlock = ({ className = '' }) => {
  return (
    <div className={`border border-[#FEAE00] rounded-lg px-12 py-12 text-center max-w-[565px] mx-auto ${className}`} data-testid="have-a-question-block">
      <div className="text-[32px] font-bold text-white leading-tight">Have a question?</div>
      <div className="text-[32px] font-bold text-white leading-tight mb-6">Contact us</div>
      <a href="tel:+359875313158" className="block text-[24px] font-bold text-[#FEAE00] hover:brightness-110">+359 875 313 158</a>
      <a href="tel:+359897884804" className="block text-[24px] font-bold text-[#FEAE00] hover:brightness-110 mt-2">+359 897 884 804</a>
    </div>
  );
};

export default HaveAQuestionBlock;
