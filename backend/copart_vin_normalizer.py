"""
Copart VIN Normalizer
Handles partial VIN normalization and search
"""

def normalize_vin(vin: str) -> dict:
    """
    Normalize VIN and detect if partial
    
    Examples:
        normalize_vin("5UXWX7C59BA932299") 
        → {"vin_raw": "5UXWX7C59BA932299", "vin_partial": False, "vin_clean": "5UXWX7C59BA932299"}
        
        normalize_vin("5UXTA6C08M9******")
        → {"vin_raw": "5UXTA6C08M9******", "vin_partial": True, "vin_clean": "5UXTA6C08M9"}
    """
    if not vin:
        return {
            "vin_raw": None,
            "vin_clean": None,
            "vin_partial": False,
            "vin_length": 0,
            "searchable_prefix": None
        }
    
    is_partial = "*" in vin
    clean_vin = vin.replace("*", "").strip()
    
    return {
        "vin_raw": vin,
        "vin_clean": clean_vin,
        "vin_partial": is_partial,
        "vin_length": len(clean_vin),
        "searchable_prefix": clean_vin[:11] if clean_vin else None  # Первые 11 символов для поиска
    }


def can_match_vins(vin1: str, vin2: str) -> bool:
    """
    Check if two VINs can match (даже если один partial)
    
    Examples:
        can_match_vins("5UXTA6C08M9******", "5UXTA6C08M9123456") → True
        can_match_vins("5UXTA6C08M9******", "1HGBH41JXMN109186") → False
    """
    norm1 = normalize_vin(vin1)
    norm2 = normalize_vin(vin2)
    
    clean1 = norm1["vin_clean"]
    clean2 = norm2["vin_clean"]
    
    if not clean1 or not clean2:
        return False
    
    # Check if one starts with the other
    return clean1.startswith(clean2) or clean2.startswith(clean1)


# For backend integration
if __name__ == "__main__":
    # Test cases
    test_vins = [
        "5UXWX7C59BA932299",    # Full VIN
        "5UXTA6C08M9******",    # Partial VIN
        "",                      # Empty
        None,                    # None
    ]
    
    for vin in test_vins:
        result = normalize_vin(vin)
        print(f"VIN: {vin}")
        print(f"  → {result}")
        print()
