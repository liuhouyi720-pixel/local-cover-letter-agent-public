import re


STATE_NAMES = {
    "Alabama": "AL",
    "Alaska": "AK",
    "Arizona": "AZ",
    "Arkansas": "AR",
    "California": "CA",
    "Colorado": "CO",
    "Connecticut": "CT",
    "Delaware": "DE",
    "District of Columbia": "DC",
    "Florida": "FL",
    "Georgia": "GA",
    "Hawaii": "HI",
    "Idaho": "ID",
    "Illinois": "IL",
    "Indiana": "IN",
    "Iowa": "IA",
    "Kansas": "KS",
    "Kentucky": "KY",
    "Louisiana": "LA",
    "Maine": "ME",
    "Maryland": "MD",
    "Massachusetts": "MA",
    "Michigan": "MI",
    "Minnesota": "MN",
    "Mississippi": "MS",
    "Missouri": "MO",
    "Montana": "MT",
    "Nebraska": "NE",
    "Nevada": "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    "Ohio": "OH",
    "Oklahoma": "OK",
    "Oregon": "OR",
    "Pennsylvania": "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    "Tennessee": "TN",
    "Texas": "TX",
    "Utah": "UT",
    "Vermont": "VT",
    "Virginia": "VA",
    "Washington": "WA",
    "West Virginia": "WV",
    "Wisconsin": "WI",
    "Wyoming": "WY",
}


def split_locations(value: str | None) -> list[str]:
    if not value:
        return []
    separator = ";" if ";" in value else "|"
    return [item.strip() for item in value.split(separator) if item.strip()]


def parse_location(raw_location: str, country: str = "United States") -> dict[str, str | None]:
    cleaned = re.sub(r"\s+", " ", raw_location).strip()
    match = re.match(r"^(.*?),\s*([^,]+?)(?:,\s*United States)?$", cleaned)
    if not match:
        return {
            "city": None,
            "state": None,
            "country": country,
            "raw_location": cleaned,
        }
    city, state_text = match.groups()
    state = STATE_NAMES.get(state_text, state_text if len(state_text) == 2 else None)
    return {
        "city": city,
        "state": state,
        "country": country,
        "raw_location": cleaned,
    }
