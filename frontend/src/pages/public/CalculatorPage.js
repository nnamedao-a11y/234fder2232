import React, { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import Breadcrumbs from '../../components/public/Breadcrumbs';
import CarCalculator from '../../components/public/CarCalculator';
import ConsultationCTAForm from '../../components/public/ConsultationCTAForm';
import HaveAQuestionBlock from '../../components/public/HaveAQuestionBlock';

export default function CalculatorPage() {
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const initialVin = (params.get('vin') || params.get('lot') || '').toUpperCase();
  const priceQ = params.get('price');
  const initialPrice =
    priceQ != null && priceQ !== '' && !Number.isNaN(Number(priceQ)) ? Number(priceQ) : null;

  return (
    <div data-testid="calculator-page" className="bg-black">
      <section className="pt-12 pb-20">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <Breadcrumbs items={[{ label: 'HOME', to: '/' }, { label: 'CALCULATOR' }]} />
          <h1 className="text-[48px] md:text-[80px] font-bold uppercase text-[#FEAE00] mt-10 leading-none">
            Calculate a car yourself{' '}
            <span className="text-white">with a price guarantee</span>
          </h1>
          <div className="text-[20px] md:text-[24px] text-white mt-6 mb-12">
            from the USA, Europe and Korea
          </div>
          <CarCalculator initialVin={initialVin} initialPrice={initialPrice} />
        </div>
      </section>
      <section className="bg-black py-16">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <HaveAQuestionBlock />
        </div>
      </section>
      <ConsultationCTAForm />
    </div>
  );
}
