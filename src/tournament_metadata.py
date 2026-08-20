GRASS = (
    "wimbledon", "boss open", "libéma", "libema", "terra wortmann", "hsbc championships",
    "eastbourne", "mallorca championships",
)
CLAY = (
    "roland garros", "monte-carlo", "madrid", "internazionali", "barcelona", "hamburg",
    "bmw open", "rio open", "argentina open", "chile open", "swiss open gstaad",
    "generali open", "geneva", "hassan ii", "estoril", "croatia open", "tiriac open",
    "u.s. men's clay court", "nordea open",
)
INDOOR_HARD = (
    "abn amro", "european open", "stockholm", "almaty", "erste bank", "paris masters",
    "swiss indoors", "moselle", "atp finals", "next gen", "open 13", "open occitanie",
    "hellenic championship",
)
MASTERS_1000_ATP = (
    "bnp paribas open", "miami open", "monte-carlo", "madrid", "internazionali",
    "national bank open", "cincinnati", "shanghai masters", "paris masters",
)
WTA_1000 = (
    "bnp paribas open", "miami open", "madrid", "internazionali", "national bank open",
    "cincinnati", "china open", "dubai duty free",
)
ATP_500 = (
    "abn amro", "mexicano", "barcelona", "hamburg", "terra wortmann", "hsbc championships",
    "mubadala dc", "china open", "japan open", "dubai duty free", "qatar exxonmobil",
    "erste bank", "swiss indoors", "rio open", "nexo dallas", "bmw open",
)
WTA_500 = ("adelaide international", "brisbane international", "mubadala dc")
SPECIAL = ("atp finals", "next gen")


def classify_tournament(name: str, tours: list, major: bool = False) -> dict:
    normalized = name.lower()
    if any(value in normalized for value in GRASS):
        surface = "Grass"
    elif any(value in normalized for value in CLAY):
        surface = "Clay"
    elif any(value in normalized for value in INDOOR_HARD):
        surface = "Indoor Hard"
    else:
        surface = "Hard"

    categories = {}
    for tour in tours:
        if major:
            categories[tour] = "Grand Slam"
        elif tour == "ATP" and any(value in normalized for value in SPECIAL):
            categories[tour] = "Finals"
        elif tour == "ATP" and any(value in normalized for value in MASTERS_1000_ATP):
            categories[tour] = "1000"
        elif tour == "WTA" and any(value in normalized for value in WTA_1000):
            categories[tour] = "1000"
        elif tour == "ATP" and any(value in normalized for value in ATP_500):
            categories[tour] = "500"
        elif tour == "WTA" and any(value in normalized for value in WTA_500):
            categories[tour] = "500"
        else:
            categories[tour] = "250"
    return {"surface": surface, "categories": categories}
