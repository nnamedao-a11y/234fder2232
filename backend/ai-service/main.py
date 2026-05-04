"""
AI Service for BIBI Cars CRM
Provides AI-powered content generation for vehicle listings
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import os
import json
import asyncio
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')

from emergentintegrations.llm.chat import LlmChat, UserMessage

app = FastAPI(title="AI Service", version="1.0.0")

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')


class VehicleData(BaseModel):
    vin: str
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    price: Optional[float] = None
    currentBid: Optional[float] = None
    location: Optional[str] = None
    mileage: Optional[int] = None
    bodyType: Optional[str] = None
    fuelType: Optional[str] = None
    transmission: Optional[str] = None
    damageType: Optional[str] = None
    isAuction: Optional[bool] = False
    auctionSource: Optional[str] = None


class EnrichmentResponse(BaseModel):
    aiDescription: str
    aiShortSummary: str
    managerHint: str
    seoTitle: str
    seoDescription: str
    seoKeywords: List[str]
    faq: List[str]


async def generate_enrichment(vehicle: VehicleData) -> EnrichmentResponse:
    """Generate AI enrichment for a vehicle listing"""
    
    display_price = vehicle.price or vehicle.currentBid or 0
    
    prompt = f"""You are generating high-conversion automotive marketplace content in Ukrainian language.

Vehicle Details:
- VIN: {vehicle.vin}
- Brand: {vehicle.make or 'Unknown'}
- Model: {vehicle.model or 'Unknown'}
- Year: {vehicle.year or 'Unknown'}
- Price/Bid: ${display_price:,.0f}
- Location: {vehicle.location or 'USA'}
- Mileage: {vehicle.mileage or 'Unknown'} miles
- Body Type: {vehicle.bodyType or 'Unknown'}
- Fuel Type: {vehicle.fuelType or 'Unknown'}
- Transmission: {vehicle.transmission or 'Unknown'}
- Damage: {vehicle.damageType or 'None'}
- Auction: {'Yes' if vehicle.isAuction else 'No'}
- Source: {vehicle.auctionSource or 'Auction'}

Generate JSON with these keys (all in Ukrainian except seoKeywords which should be in English):
1. aiDescription - persuasive sales description (120-180 words), highlight value and opportunity
2. aiShortSummary - 1-2 sentences summary
3. managerHint - short actionable sales tip for manager
4. seoTitle - max 60 chars, include brand model year
5. seoDescription - max 155 chars for Google
6. seoKeywords - array of 5-8 English keywords for SEO
7. faq - array of 3 short FAQ items about buying this type of car

Make content persuasive and professional. Focus on value proposition.
Return ONLY valid JSON, no markdown."""

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"vehicle-enrich-{vehicle.vin}",
            system_message="You are an expert automotive content writer. Always respond with valid JSON only."
        ).with_model("openai", "gpt-4o-mini")
        
        user_message = UserMessage(text=prompt)
        response = await chat.send_message(user_message)
        
        # Parse response
        response_text = response.strip()
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
        
        data = json.loads(response_text)
        
        return EnrichmentResponse(
            aiDescription=data.get('aiDescription', ''),
            aiShortSummary=data.get('aiShortSummary', ''),
            managerHint=data.get('managerHint', ''),
            seoTitle=data.get('seoTitle', '')[:60],
            seoDescription=data.get('seoDescription', '')[:155],
            seoKeywords=data.get('seoKeywords', [])[:8],
            faq=data.get('faq', [])[:3]
        )
        
    except json.JSONDecodeError as e:
        # Fallback response
        return EnrichmentResponse(
            aiDescription=f"Відмінний {vehicle.make} {vehicle.model} {vehicle.year} року за привабливою ціною. Автомобіль виставлений на аукціоні та доступний для придбання з доставкою в Україну.",
            aiShortSummary=f"{vehicle.make} {vehicle.model} {vehicle.year} з аукціону США.",
            managerHint="Перевірте історію VIN та запропонуйте розрахунок доставки.",
            seoTitle=f"{vehicle.year} {vehicle.make} {vehicle.model} з аукціону",
            seoDescription=f"Купити {vehicle.make} {vehicle.model} {vehicle.year} з аукціону США. Ціна від ${display_price:,.0f}. Доставка в Україну.",
            seoKeywords=[f"{vehicle.make}", f"{vehicle.model}", "auction cars", "usa cars", "import cars"],
            faq=["Як купити авто з аукціону?", "Скільки коштує доставка?", "Які документи потрібні?"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ai"}


@app.post("/enrich", response_model=EnrichmentResponse)
async def enrich_vehicle(vehicle: VehicleData):
    """Generate AI content enrichment for a vehicle listing"""
    return await generate_enrichment(vehicle)


@app.post("/batch-enrich")
async def batch_enrich(vehicles: List[VehicleData]):
    """Generate AI content for multiple vehicles"""
    results = []
    for vehicle in vehicles[:10]:  # Limit to 10 at a time
        try:
            result = await generate_enrichment(vehicle)
            results.append({"vin": vehicle.vin, "success": True, "data": result.model_dump()})
        except Exception as e:
            results.append({"vin": vehicle.vin, "success": False, "error": str(e)})
    return results


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)
