/**
 * Seed script for auction data
 * Run: npx ts-node -r tsconfig-paths/register scripts/seed-auctions.ts
 */

import * as mongoose from 'mongoose';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'test_database';

// Sample vehicle data for testing
const sampleVehicles = [
  // Hot auctions (ending within 24 hours)
  {
    vin: '1HGBH41JXMN109186',
    source: 'copart',
    lotNumber: 'LOT-45891234',
    title: '2021 Honda Accord Sport',
    make: 'Honda',
    model: 'Accord',
    year: 2021,
    price: 15500,
    mileage: 32000,
    damageType: 'Front End',
    location: 'Los Angeles, CA',
    images: [
      'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=800',
      'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800',
    ],
    auctionDate: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours
    confidence: 0.95,
  },
  {
    vin: '5XYZU3LB5DG008761',
    source: 'iaai',
    lotNumber: 'LOT-78234512',
    title: '2022 Hyundai Santa Fe Limited',
    make: 'Hyundai',
    model: 'Santa Fe',
    year: 2022,
    price: 22000,
    mileage: 18000,
    damageType: 'Side',
    location: 'Houston, TX',
    images: [
      'https://images.unsplash.com/photo-1606016159991-dfe4f2746ad5?w=800',
    ],
    auctionDate: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours
    confidence: 0.88,
  },
  {
    vin: 'WVWZZZ3CZWE123456',
    source: 'copart',
    lotNumber: 'LOT-33456789',
    title: '2020 Volkswagen Tiguan SE',
    make: 'Volkswagen',
    model: 'Tiguan',
    year: 2020,
    price: 18500,
    mileage: 45000,
    damageType: 'Rear End',
    location: 'Dallas, TX',
    images: [
      'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=800',
    ],
    auctionDate: new Date(Date.now() + 18 * 60 * 60 * 1000), // 18 hours
    confidence: 0.92,
  },
  // Ending soon (within 48 hours)
  {
    vin: 'JN1TBNT30Z0123456',
    source: 'iaai',
    lotNumber: 'LOT-11234567',
    title: '2023 Nissan Altima SV',
    make: 'Nissan',
    model: 'Altima',
    year: 2023,
    price: 17800,
    mileage: 12000,
    damageType: 'Minor Dent/Scratch',
    location: 'Phoenix, AZ',
    images: [
      'https://images.unsplash.com/photo-1580274455191-1c62238fa333?w=800',
    ],
    auctionDate: new Date(Date.now() + 30 * 60 * 60 * 1000), // 30 hours
    confidence: 0.85,
  },
  {
    vin: '1G1YY22G565123456',
    source: 'copart',
    lotNumber: 'LOT-22345678',
    title: '2019 Chevrolet Corvette Stingray',
    make: 'Chevrolet',
    model: 'Corvette',
    year: 2019,
    price: 45000,
    mileage: 8500,
    damageType: 'Water/Flood',
    location: 'Miami, FL',
    images: [
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800',
      'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=800',
    ],
    auctionDate: new Date(Date.now() + 36 * 60 * 60 * 1000), // 36 hours
    confidence: 0.78,
  },
  // Upcoming auctions (within 7 days)
  {
    vin: 'WAUDFAFL3DN123456',
    source: 'iaai',
    lotNumber: 'LOT-44567890',
    title: '2022 Audi A4 Premium',
    make: 'Audi',
    model: 'A4',
    year: 2022,
    price: 28500,
    mileage: 22000,
    damageType: 'Front End',
    location: 'Chicago, IL',
    images: [
      'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800',
    ],
    auctionDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
    confidence: 0.90,
  },
  {
    vin: '3MW5R1J05M8123456',
    source: 'copart',
    lotNumber: 'LOT-55678901',
    title: '2021 BMW 330i M Sport',
    make: 'BMW',
    model: '330i',
    year: 2021,
    price: 32000,
    mileage: 28000,
    damageType: 'Mechanical',
    location: 'New York, NY',
    images: [
      'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800',
    ],
    auctionDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days
    confidence: 0.82,
  },
  {
    vin: '1C4RJFAG4LC123456',
    source: 'iaai',
    lotNumber: 'LOT-66789012',
    title: '2020 Jeep Grand Cherokee Limited',
    make: 'Jeep',
    model: 'Grand Cherokee',
    year: 2020,
    price: 25000,
    mileage: 48000,
    damageType: 'Collision',
    location: 'Denver, CO',
    images: [
      'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800',
    ],
    auctionDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
    confidence: 0.87,
  },
  {
    vin: '2T1BURHE7JC123456',
    source: 'copart',
    lotNumber: 'LOT-77890123',
    title: '2023 Toyota Corolla LE',
    make: 'Toyota',
    model: 'Corolla',
    year: 2023,
    price: 14500,
    mileage: 8000,
    damageType: 'Rear End',
    location: 'Seattle, WA',
    images: [
      'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800',
    ],
    auctionDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), // 6 days
    confidence: 0.93,
  },
  {
    vin: '5YJ3E1EA7KF123456',
    source: 'iaai',
    lotNumber: 'LOT-88901234',
    title: '2022 Tesla Model 3 Long Range',
    make: 'Tesla',
    model: 'Model 3',
    year: 2022,
    price: 35000,
    mileage: 15000,
    damageType: 'Electrical',
    location: 'San Francisco, CA',
    images: [
      'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800',
    ],
    auctionDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days
    confidence: 0.75,
  },
  // More variety
  {
    vin: '1FMCU0G65KUB12345',
    source: 'copart',
    lotNumber: 'LOT-99012345',
    title: '2019 Ford Escape SE',
    make: 'Ford',
    model: 'Escape',
    year: 2019,
    price: 12000,
    mileage: 55000,
    damageType: 'Vandalism',
    location: 'Atlanta, GA',
    images: [
      'https://images.unsplash.com/photo-1606220838315-056192d5e927?w=800',
    ],
    auctionDate: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
    confidence: 0.70,
  },
  {
    vin: 'WDDWJ8KB5KF123456',
    source: 'iaai',
    lotNumber: 'LOT-10123456',
    title: '2023 Mercedes-Benz C300',
    make: 'Mercedes-Benz',
    model: 'C300',
    year: 2023,
    price: 42000,
    mileage: 5000,
    damageType: 'Front End',
    location: 'Las Vegas, NV',
    images: [
      'https://images.unsplash.com/photo-1617531653332-bd46c24f2068?w=800',
    ],
    auctionDate: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
    confidence: 0.96,
  },
  {
    vin: '4T1B11HK5JU123456',
    source: 'copart',
    lotNumber: 'LOT-21234567',
    title: '2018 Toyota Camry XLE',
    make: 'Toyota',
    model: 'Camry',
    year: 2018,
    price: 11000,
    mileage: 78000,
    damageType: 'Biohazard/Chemical',
    location: 'Portland, OR',
    images: [
      'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800',
    ],
    auctionDate: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    confidence: 0.65,
  },
];

// Calculate ranking score
function calculateRanking(vehicle: any) {
  const auctionConfidence = Math.min(1, vehicle.confidence || 0.5);

  // Timer urgency
  const diffMs = vehicle.auctionDate.getTime() - Date.now();
  const hours = diffMs / (1000 * 60 * 60);
  let timerUrgency = 0;
  if (hours <= 0) timerUrgency = 0;
  else if (hours <= 3) timerUrgency = 1;
  else if (hours <= 12) timerUrgency = 0.9;
  else if (hours <= 24) timerUrgency = 0.8;
  else if (hours <= 48) timerUrgency = 0.6;
  else if (hours <= 96) timerUrgency = 0.4;
  else timerUrgency = 0.2;

  // Data completeness
  let dataCompleteness = 0;
  if (vehicle.vin) dataCompleteness += 0.2;
  if (vehicle.lotNumber) dataCompleteness += 0.2;
  if (vehicle.auctionDate) dataCompleteness += 0.2;
  if (vehicle.location) dataCompleteness += 0.15;
  if (vehicle.price) dataCompleteness += 0.1;
  if (vehicle.images?.length) dataCompleteness += 0.15;
  dataCompleteness = Math.min(1, dataCompleteness);

  // Source quality (simplified)
  const sourceQuality = vehicle.source === 'copart' ? 0.9 : 0.85;

  // Image quality
  const imgCount = vehicle.images?.length || 0;
  let imageQuality = 0;
  if (imgCount >= 10) imageQuality = 1;
  else if (imgCount >= 6) imageQuality = 0.8;
  else if (imgCount >= 3) imageQuality = 0.6;
  else if (imgCount >= 1) imageQuality = 0.4;

  // Price signal
  const priceSignal = vehicle.price ? 1 : 0;

  // Ranking score
  const rankingScore =
    auctionConfidence * 0.25 +
    timerUrgency * 0.25 +
    dataCompleteness * 0.2 +
    sourceQuality * 0.15 +
    imageQuality * 0.1 +
    priceSignal * 0.05;

  return {
    rankingScore: Number(rankingScore.toFixed(3)),
    timerUrgency: Number(timerUrgency.toFixed(3)),
    dataCompleteness: Number(dataCompleteness.toFixed(3)),
    sourceQuality: Number(sourceQuality.toFixed(3)),
    imageQuality: Number(imageQuality.toFixed(3)),
    priceSignal,
  };
}

async function seed() {
  console.log('🚀 Starting auction seed...');

  await mongoose.connect(`${MONGO_URL}/${DB_NAME}`);
  console.log('✅ Connected to MongoDB');

  const auctionCollection = mongoose.connection.collection('auctions');

  // Clear existing
  await auctionCollection.deleteMany({});
  console.log('🗑️ Cleared existing auctions');

  // Insert new auctions
  const auctions = sampleVehicles.map((v) => {
    const ranking = calculateRanking(v);
    return {
      ...v,
      ...ranking,
      isActive: true,
      lastSeenAt: new Date(),
      expiresAt: new Date(v.auctionDate.getTime() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  await auctionCollection.insertMany(auctions);
  console.log(`✅ Inserted ${auctions.length} auctions`);

  // Show stats
  const total = await auctionCollection.countDocuments();
  const hot = await auctionCollection.countDocuments({ rankingScore: { $gte: 0.5 } });
  console.log(`📊 Stats: Total=${total}, Hot=${hot}`);

  await mongoose.disconnect();
  console.log('✅ Done!');
}

seed().catch(console.error);
