/**
 * Seed Quote Analytics Test Data
 * Run: npx ts-node scripts/seed-quotes.ts
 */

import { connect } from 'mongoose';
import { randomBytes } from 'crypto';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'test_database';

const scenarios = ['minimum', 'recommended', 'aggressive'];
const sources = ['vin', 'manual', 'admin', 'manager'];

function generateQuoteNumber() {
  const year = new Date().getFullYear();
  const num = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `QT-${year}-${num}`;
}

async function seedQuotes() {
  console.log('🌱 Seeding Quote Analytics Test Data...\n');
  
  const conn = await connect(`${MONGO_URL}/${DB_NAME}`);
  const db = conn.connection.db;
  
  // Get users for managerId
  const users = await db.collection('users').find({}).toArray();
  const managerIds = users.map(u => u._id);
  
  const quotes = [];
  const now = new Date();
  
  // Generate 50 quotes over last 30 days
  for (let i = 0; i < 50; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    
    const carPrice = 5000 + Math.floor(Math.random() * 30000);
    const hiddenFee = Math.floor(carPrice * (0.08 + Math.random() * 0.07)); // 8-15% margin
    const visibleTotal = carPrice + 2000 + Math.floor(Math.random() * 3000);
    const internalTotal = visibleTotal + hiddenFee;
    
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    const source = sources[Math.floor(Math.random() * sources.length)];
    const convertedToLead = Math.random() > 0.6;
    const hasOverride = Math.random() > 0.7;
    
    const history = [];
    let finalPrice = null;
    
    if (hasOverride) {
      const overrideAmount = Math.floor(visibleTotal * (0.95 + Math.random() * 0.1));
      finalPrice = overrideAmount;
      history.push({
        action: 'PRICE_OVERRIDE',
        timestamp: new Date(createdAt.getTime() + 1000 * 60 * 60), // 1 hour later
        userId: managerIds.length ? managerIds[Math.floor(Math.random() * managerIds.length)].toString() : 'system',
        oldValue: { visibleTotal },
        newValue: { 
          overridePrice: overrideAmount,
          reason: 'Customer negotiation'
        }
      });
    }
    
    const quote = {
      quoteNumber: generateQuoteNumber(),
      vin: `WBA${Math.random().toString(36).substring(2, 8).toUpperCase()}${Math.floor(Math.random() * 1000000)}`,
      vehicleTitle: `${2015 + Math.floor(Math.random() * 10)} Test Vehicle ${i + 1}`,
      input: {
        price: carPrice,
        port: ['NJ', 'GA', 'TX', 'CA'][Math.floor(Math.random() * 4)],
        vehicleType: ['sedan', 'suv', 'truck'][Math.floor(Math.random() * 3)]
      },
      breakdown: {
        carPrice,
        auctionFee: Math.floor(carPrice * 0.08),
        insurance: Math.floor(carPrice * 0.015),
        usaInland: 300 + Math.floor(Math.random() * 200),
        ocean: 800 + Math.floor(Math.random() * 400),
        usaHandlingFee: 150,
        bankFee: 50,
        euPortHandlingFee: 200,
        euDelivery: 300 + Math.floor(Math.random() * 200),
        companyFee: 500,
        customs: Math.floor(carPrice * 0.1),
        documentationFee: 100,
        titleFee: 50
      },
      visibleTotal,
      internalTotal,
      hiddenFee,
      profileCode: 'STANDARD',
      scenarios: {
        minimum: Math.floor(visibleTotal * 0.95),
        recommended: visibleTotal,
        aggressive: Math.floor(visibleTotal * 1.1)
      },
      selectedScenario: scenario,
      finalPrice,
      createdFrom: source,
      convertedToLead,
      managerId: managerIds.length ? managerIds[Math.floor(Math.random() * managerIds.length)] : null,
      status: convertedToLead ? 'accepted' : ['draft', 'sent', 'expired'][Math.floor(Math.random() * 3)],
      history,
      createdAt,
      updatedAt: createdAt
    };
    
    quotes.push(quote);
  }
  
  // Insert quotes
  await db.collection('quotes').insertMany(quotes);
  
  console.log(`✅ Created ${quotes.length} test quotes`);
  console.log(`   - Converted to leads: ${quotes.filter(q => q.convertedToLead).length}`);
  console.log(`   - With overrides: ${quotes.filter(q => q.history.length > 0).length}`);
  console.log(`   - Scenarios: minimum=${quotes.filter(q => q.selectedScenario === 'minimum').length}, recommended=${quotes.filter(q => q.selectedScenario === 'recommended').length}, aggressive=${quotes.filter(q => q.selectedScenario === 'aggressive').length}`);
  
  await conn.disconnect();
  console.log('\n✅ Quote seeding completed!');
  process.exit(0);
}

seedQuotes().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
