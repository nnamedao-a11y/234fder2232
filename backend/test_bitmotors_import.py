import logging
logging.basicConfig(level=logging.INFO)

print("=== Testing Bitmotors Import ===")

try:
    from bitmotors_scraper import BitmotorsScraper
    print("✓ BitmotorsScraper loaded successfully")
    print(f"✓ Class: {BitmotorsScraper}")
    BITMOTORS_AVAILABLE = True
except Exception as e:
    print(f"✗ Import failed: {e}")
    import traceback
    traceback.print_exc()
    BITMOTORS_AVAILABLE = False

print(f"BITMOTORS_AVAILABLE = {BITMOTORS_AVAILABLE}")
