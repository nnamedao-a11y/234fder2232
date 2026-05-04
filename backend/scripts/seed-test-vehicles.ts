/**
 * Seed Test Vehicles
 * Run: npx ts-node -r tsconfig-paths/register scripts/seed-test-vehicles.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';

async function seedTestVehicles() {
  console.log('🚗 Seeding Test Vehicles');
  console.log('========================\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const vehicleModel = app.get(getModelToken('Vehicle')) as Model<any>;

  // Check if test vehicles exist
  const existing = await vehicleModel.findOne({ vin: 'WBA3B3C50EF123456' });
  if (existing) {
    console.log('✓ Test vehicles already exist');
    await app.close();
    return;
  }

  const testVehicles = [
    {
      vin: 'WBA3B3C50EF123456',
      source: 'copart',
      externalId: 'LOT123456',
      title: '2014 BMW 328i xDrive',
      year: 2014,
      make: 'BMW',
      vehicleModel: '328i',
      mileage: 85000,
      price: 8500,
      damageType: 'Front End',
      lotNumber: 'LOT123456',
      saleDate: new Date('2026-04-15'),
      auctionLocation: 'Copart Los Angeles',
      location: 'Los Angeles, CA',
      images: [
        'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=600',
        'https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=600'
      ],
      sources: ['copart'],
      sourceUrl: 'https://copart.com/lot/123456',
      score: 85,
      isAuction: true,
      status: 'active',
    },
    {
      vin: 'WVWZZZ3CZWE123789',
      source: 'iaai',
      externalId: 'LOT789123',
      title: '2019 Volkswagen Tiguan SEL',
      year: 2019,
      make: 'Volkswagen',
      vehicleModel: 'Tiguan',
      mileage: 45000,
      price: 15500,
      damageType: 'Minor Damage',
      lotNumber: 'LOT789123',
      saleDate: new Date('2026-04-18'),
      auctionLocation: 'IAAI Houston',
      location: 'Houston, TX',
      images: [
        'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=600',
        'https://images.unsplash.com/photo-1616788494707-ec28f08d05a1?w=600'
      ],
      sources: ['iaai'],
      sourceUrl: 'https://iaai.com/lot/789123',
      score: 90,
      isAuction: true,
      status: 'active',
    },
    {
      vin: 'JN1TANT31U0000001',
      source: 'copart',
      externalId: 'LOT456789',
      title: '2020 Nissan Rogue SV',
      year: 2020,
      make: 'Nissan',
      vehicleModel: 'Rogue',
      mileage: 32000,
      price: 18000,
      damageType: 'Clean Title',
      lotNumber: 'LOT456789',
      saleDate: new Date('2026-04-20'),
      auctionLocation: 'Copart New York',
      location: 'Newark, NJ',
      images: [
        'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=600',
        'https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?w=600'
      ],
      sources: ['copart'],
      sourceUrl: 'https://copart.com/lot/456789',
      score: 95,
      isAuction: true,
      status: 'active',
    },
    {
      vin: '1HGCV1F34KA000001',
      source: 'iaai',
      externalId: 'LOT111222',
      title: '2019 Honda Accord Sport',
      year: 2019,
      make: 'Honda',
      vehicleModel: 'Accord',
      mileage: 55000,
      price: 12500,
      damageType: 'Rear End',
      lotNumber: 'LOT111222',
      saleDate: new Date('2026-04-22'),
      auctionLocation: 'IAAI Miami',
      location: 'Miami, FL',
      images: [
        'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=600'
      ],
      sources: ['iaai'],
      sourceUrl: 'https://iaai.com/lot/111222',
      score: 80,
      isAuction: true,
      status: 'active',
    },
    {
      vin: '5YJSA1E29KF000001',
      source: 'copart',
      externalId: 'LOT999888',
      title: '2019 Tesla Model S 75D',
      year: 2019,
      make: 'Tesla',
      vehicleModel: 'Model S',
      mileage: 28000,
      price: 35000,
      damageType: 'Minor Damage',
      lotNumber: 'LOT999888',
      saleDate: new Date('2026-04-25'),
      auctionLocation: 'Copart Dallas',
      location: 'Dallas, TX',
      images: [
        'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=600',
        'https://images.unsplash.com/photo-1536700503339-1e4b06520771?w=600'
      ],
      sources: ['copart'],
      sourceUrl: 'https://copart.com/lot/999888',
      score: 92,
      isAuction: true,
      status: 'active',
    }
  ];

  await vehicleModel.insertMany(testVehicles);
  console.log(`✓ Created ${testVehicles.length} test vehicles`);

  console.log('\nTest VINs:');
  testVehicles.forEach(v => {
    console.log(`  - ${v.vin}: ${v.title} ($${v.price.toLocaleString()})`);
  });

  await app.close();
  console.log('\n✅ Test vehicles seeded successfully!');
  process.exit(0);
}

seedTestVehicles().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
