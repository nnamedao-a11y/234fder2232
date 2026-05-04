/**
 * Calculator Seed Script
 * Run: npx ts-node -r tsconfig-paths/register scripts/seed-calculator.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';

async function seedCalculator() {
  console.log('🧮 Calculator Seed Script');
  console.log('==========================\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const profileModel = app.get(getModelToken('CalculatorProfile')) as Model<any>;
  const routeRateModel = app.get(getModelToken('RouteRate')) as Model<any>;
  const auctionFeeModel = app.get(getModelToken('AuctionFeeRule')) as Model<any>;

  // Check if already seeded
  const existingProfile = await profileModel.findOne({ code: 'standard_bg' });
  if (existingProfile) {
    console.log('✓ Calculator already seeded');
    await app.close();
    return;
  }

  console.log('Creating calculator profile...');

  // 1. Create Calculator Profile
  const profile = await profileModel.create({
    code: 'standard_bg',
    name: 'Standard Bulgaria',
    description: 'Стандартний профіль для Болгарії',
    destinationCountry: 'BG',
    currency: 'USD',
    isActive: true,
    
    // Fixed fees
    insuranceRate: 0.015,    // 1.5% від ціни
    customsRate: 0.10,       // 10% розмитнення
    usaHandlingFee: 150,
    bankFee: 50,
    euPortHandlingFee: 200,
    companyFee: 1500,        // Послуги компанії
    documentationFee: 75,
    titleFee: 100,
    
    // Hidden fees (margin control)
    hiddenFeeThreshold: 5000,
    hiddenFeeUnder5000: 500,
    hiddenFeeOver5000: 700,
  });

  console.log(`✓ Created profile: ${profile.name}`);

  // 2. Create Route Rates (USA Inland)
  console.log('Creating USA inland rates...');
  
  const ports = [
    'copart_los_angeles',
    'copart_dallas', 
    'copart_houston',
    'copart_miami',
    'copart_new_york',
    'iaai_los_angeles',
    'iaai_dallas',
    'iaai_houston',
    'iaai_miami',
    'iaai_new_york',
  ];

  const vehicleTypes = ['sedan', 'suv', 'bigSUV', 'pickup'];
  
  // USA Inland rates
  const inlandRates = {
    copart_los_angeles: { sedan: 350, suv: 400, bigSUV: 450, pickup: 500 },
    copart_dallas: { sedan: 300, suv: 350, bigSUV: 400, pickup: 450 },
    copart_houston: { sedan: 280, suv: 330, bigSUV: 380, pickup: 430 },
    copart_miami: { sedan: 320, suv: 370, bigSUV: 420, pickup: 470 },
    copart_new_york: { sedan: 400, suv: 450, bigSUV: 500, pickup: 550 },
    iaai_los_angeles: { sedan: 360, suv: 410, bigSUV: 460, pickup: 510 },
    iaai_dallas: { sedan: 310, suv: 360, bigSUV: 410, pickup: 460 },
    iaai_houston: { sedan: 290, suv: 340, bigSUV: 390, pickup: 440 },
    iaai_miami: { sedan: 330, suv: 380, bigSUV: 430, pickup: 480 },
    iaai_new_york: { sedan: 410, suv: 460, bigSUV: 510, pickup: 560 },
  };

  const inlandDocs: any[] = [];
  for (const port of ports) {
    for (const vType of vehicleTypes) {
      inlandDocs.push({
        profileCode: 'standard_bg',
        rateType: 'usa_inland',
        originCode: port,
        vehicleType: vType,
        amount: (inlandRates as any)[port]?.[vType] || 400,
        currency: 'USD',
        isActive: true,
      });
    }
  }
  
  await routeRateModel.insertMany(inlandDocs);
  console.log(`✓ Created ${inlandDocs.length} USA inland rates`);

  // Ocean rates
  console.log('Creating ocean rates...');
  
  const oceanRates = {
    copart_los_angeles: { sedan: 1200, suv: 1350, bigSUV: 1500, pickup: 1600 },
    copart_dallas: { sedan: 1100, suv: 1250, bigSUV: 1400, pickup: 1500 },
    copart_houston: { sedan: 1000, suv: 1150, bigSUV: 1300, pickup: 1400 },
    copart_miami: { sedan: 900, suv: 1050, bigSUV: 1200, pickup: 1300 },
    copart_new_york: { sedan: 1000, suv: 1150, bigSUV: 1300, pickup: 1400 },
    iaai_los_angeles: { sedan: 1250, suv: 1400, bigSUV: 1550, pickup: 1650 },
    iaai_dallas: { sedan: 1150, suv: 1300, bigSUV: 1450, pickup: 1550 },
    iaai_houston: { sedan: 1050, suv: 1200, bigSUV: 1350, pickup: 1450 },
    iaai_miami: { sedan: 950, suv: 1100, bigSUV: 1250, pickup: 1350 },
    iaai_new_york: { sedan: 1050, suv: 1200, bigSUV: 1350, pickup: 1450 },
  };

  const oceanDocs: any[] = [];
  for (const port of ports) {
    for (const vType of vehicleTypes) {
      oceanDocs.push({
        profileCode: 'standard_bg',
        rateType: 'ocean',
        originCode: port,
        vehicleType: vType,
        amount: (oceanRates as any)[port]?.[vType] || 1200,
        currency: 'USD',
        isActive: true,
      });
    }
  }
  
  await routeRateModel.insertMany(oceanDocs);
  console.log(`✓ Created ${oceanDocs.length} ocean rates`);

  // EU Delivery rates
  console.log('Creating EU delivery rates...');
  
  const euDeliveryDocs: any[] = [];
  for (const vType of vehicleTypes) {
    const baseRate = vType === 'sedan' ? 400 : vType === 'suv' ? 450 : vType === 'bigSUV' ? 500 : 550;
    euDeliveryDocs.push({
      profileCode: 'standard_bg',
      rateType: 'eu_delivery',
      destinationCode: 'BG',
      vehicleType: vType,
      amount: baseRate,
      currency: 'USD',
      isActive: true,
    });
  }
  
  await routeRateModel.insertMany(euDeliveryDocs);
  console.log(`✓ Created ${euDeliveryDocs.length} EU delivery rates`);

  // 3. Create Auction Fee Rules
  console.log('Creating auction fee rules...');
  
  const auctionFees = [
    { minBid: 0, maxBid: 99.99, fee: 1 },
    { minBid: 100, maxBid: 499.99, fee: 49 },
    { minBid: 500, maxBid: 999.99, fee: 75 },
    { minBid: 1000, maxBid: 1499.99, fee: 110 },
    { minBid: 1500, maxBid: 1999.99, fee: 135 },
    { minBid: 2000, maxBid: 3999.99, fee: 200 },
    { minBid: 4000, maxBid: 5999.99, fee: 280 },
    { minBid: 6000, maxBid: 7999.99, fee: 360 },
    { minBid: 8000, maxBid: 9999.99, fee: 400 },
    { minBid: 10000, maxBid: 14999.99, fee: 450 },
    { minBid: 15000, maxBid: 19999.99, fee: 550 },
    { minBid: 20000, maxBid: 29999.99, fee: 650 },
    { minBid: 30000, maxBid: 49999.99, fee: 800 },
    { minBid: 50000, maxBid: 99999.99, fee: 1000 },
    { minBid: 100000, maxBid: 9999999, fee: 1200 },
  ];

  const feeDocs = auctionFees.map(f => ({
    profileCode: 'standard_bg',
    minBid: f.minBid,
    maxBid: f.maxBid,
    fee: f.fee,
    currency: 'USD',
    isActive: true,
  }));
  
  await auctionFeeModel.insertMany(feeDocs);
  console.log(`✓ Created ${feeDocs.length} auction fee rules`);

  // Summary
  const totalRates = inlandDocs.length + oceanDocs.length + euDeliveryDocs.length;
  console.log('\n✅ Calculator seed completed!');
  console.log(`   Profiles: 1`);
  console.log(`   Route rates: ${totalRates}`);
  console.log(`   Auction rules: ${feeDocs.length}`);

  await app.close();
  process.exit(0);
}

seedCalculator().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
