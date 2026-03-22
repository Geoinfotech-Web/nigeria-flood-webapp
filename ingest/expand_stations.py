"""
Station Expansion — Nigeria Flood Dashboard
============================================
Adds 20 new gauge stations across all major Nigerian river basins
and 20 catchment-level met stations (one per gauge location).

Coverage added:
  Niger River    — Jebba, Kainji, Idah, Asaba
  Benue River    — Makurdi, Ibi, Numan
  Kaduna River   — Shiroro, Kaduna town
  Cross River    — Ikom, Calabar
  Anambra River  — Otuocha
  Ogun River     — Abeokuta
  Hadejia River  — Hadejia town
  Komadugu Yobe  — Gashua
  Sokoto/Rima    — Argungu
  Gongola/Benue  — Yola
  Osun River     — Osogbo
  Imo River      — Owerri
  Zamfara River  — Gusau
  Katsina Ala    — Takum

Run:  DB_HOST=localhost python ingest/expand_stations.py
"""

import os
import sys
import logging

import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [expand] %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)

# ── New gauge stations ────────────────────────────────────────────────────────
# (code, name, river, state, lat, lon, bank_full_m)
NEW_GAUGE_STATIONS = [
    # Niger River
    ("NIGER_JEB",  "Jebba Dam",          "Niger",        "Kwara",     9.1167,  4.8167, 15.0),
    ("NIGER_KAI",  "Kainji Downstream",  "Niger",        "Niger",    10.3667,  4.6333, 16.5),
    ("NIGER_IDA",  "Idah Crossing",      "Niger",        "Kogi",      7.1000,  6.7333, 13.5),
    ("NIGER_ASA",  "Asaba",              "Niger",        "Delta",     6.2034,  6.7260, 11.0),

    # Benue River
    ("BENUE_MAK",  "Makurdi",            "Benue",        "Benue",     7.7316,  8.5213, 11.5),
    ("BENUE_IBI",  "Ibi",                "Benue",        "Taraba",    8.1833,  9.7333,  9.0),
    ("BENUE_NUM",  "Numan",              "Benue",        "Adamawa",   9.4667, 12.0333,  8.5),

    # Kaduna River
    ("KADUNA_SHI", "Shiroro Dam",        "Kaduna",       "Niger",    10.5000,  6.8333,  7.5),
    ("KADUNA_KAD", "Kaduna City",        "Kaduna",       "Kaduna",   10.5272,  7.4424,  6.5),

    # Cross River
    ("CROSS_IKO",  "Ikom",               "Cross River",  "Cross River", 5.9618, 8.7087,  8.5),
    ("CROSS_CAL",  "Calabar",            "Cross River",  "Cross River", 4.9481, 8.3220,  7.0),

    # Anambra River
    ("ANAM_OTU",   "Otuocha",            "Anambra",      "Anambra",   6.5000,  6.8333,  8.0),

    # Ogun River
    ("OGUN_ABE",   "Abeokuta",           "Ogun",         "Ogun",      7.1475,  3.3508,  6.0),

    # Hadejia River
    ("HADEJIA_HAD","Hadejia",            "Hadejia",      "Jigawa",   12.4544, 10.0456,  4.5),

    # Komadugu Yobe (feeds Lake Chad)
    ("YOBE_GAS",   "Gashua",             "Komadugu Yobe","Yobe",     12.8700, 11.0500,  4.0),

    # Sokoto/Rima
    ("SOKOTO_ARG", "Argungu",            "Rima",         "Kebbi",    12.7447,  4.5232,  5.5),

    # Gongola (Benue tributary)
    ("GONG_YOL",   "Yola",               "Benue/Gongola","Adamawa",   9.2035, 12.4954,  7.5),

    # Osun River
    ("OSUN_OSO",   "Osogbo",             "Osun",         "Osun",      7.7826,  4.5418,  5.0),

    # Imo River
    ("IMO_OWE",    "Owerri",             "Imo",          "Imo",       5.4836,  7.0331,  4.5),

    # Zamfara River
    ("ZAMFARA_GUS","Gusau",              "Zamfara",      "Zamfara",  12.1704,  6.6644,  4.0),

    # Katsina Ala (major Benue tributary)
    ("KATALA_TAK", "Takum",              "Katsina Ala",  "Taraba",    7.2647,  9.9736,  6.5),
]

# ── Catchment met stations ────────────────────────────────────────────────────
# One rainfall sampling point per gauge station location (+ existing cities)
# (code, name, lat, lon)
NEW_MET_STATIONS = [
    # Catchment points for new gauges
    ("MET_JEBBA",   "Jebba Catchment",      9.1167,  4.8167),
    ("MET_KAINJI",  "Kainji Catchment",    10.3667,  4.6333),
    ("MET_IDAH",    "Idah Catchment",       7.1000,  6.7333),
    ("MET_ASABA",   "Asaba Catchment",      6.2034,  6.7260),
    ("MET_MAKURDI", "Makurdi Catchment",    7.7316,  8.5213),
    ("MET_IBI",     "Ibi Catchment",        8.1833,  9.7333),
    ("MET_NUMAN",   "Numan Catchment",      9.4667, 12.0333),
    ("MET_SHIRORO", "Shiroro Catchment",   10.5000,  6.8333),
    ("MET_IKOM",    "Ikom Catchment",       5.9618,  8.7087),
    ("MET_CALABAR", "Calabar Catchment",    4.9481,  8.3220),
    ("MET_OTUOCHA", "Otuocha Catchment",    6.5000,  6.8333),
    ("MET_ABEOK",   "Abeokuta Catchment",   7.1475,  3.3508),
    ("MET_HADEJIA", "Hadejia Catchment",   12.4544, 10.0456),
    ("MET_GASHUA",  "Gashua Catchment",    12.8700, 11.0500),
    ("MET_ARGUNGU", "Argungu Catchment",   12.7447,  4.5232),
    ("MET_YOLA",    "Yola Catchment",       9.2035, 12.4954),
    ("MET_OSOGBO",  "Osogbo Catchment",     7.7826,  4.5418),
    ("MET_OWERRI",  "Owerri Catchment",     5.4836,  7.0331),
    ("MET_GUSAU",   "Gusau Catchment",     12.1704,  6.6644),
    ("MET_TAKUM",   "Takum Catchment",      7.2647,  9.9736),
    # Extra strategic cities
    ("MET_MAIDUGURI","Maiduguri",          11.8460, 13.1571),
    ("MET_SOKOTO",  "Sokoto City",         13.0622,  5.2339),
    ("MET_BENIN",   "Benin City",           6.3350,  5.6270),
    ("MET_ENUGU",   "Enugu",               6.4584,  7.5464),
    ("MET_KADUNA",  "Kaduna City",         10.5105,  7.4165),
]


def insert_gauge_stations(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT code FROM gauge_stations")
        existing = {r[0] for r in cur.fetchall()}

    new = [s for s in NEW_GAUGE_STATIONS if s[0] not in existing]
    if not new:
        log.info("All gauge stations already present — skipping")
        return 0

    rows = [
        (code, name, river, state, lat, lon, bank_full,
         f"ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326)")
        for code, name, river, state, lat, lon, bank_full in new
    ]

    with conn.cursor() as cur:
        for code, name, river, state, lat, lon, bank_full in new:
            cur.execute("""
                INSERT INTO gauge_stations
                  (code, name, river, state, lat, lon, bank_full_m, geom)
                VALUES (%s, %s, %s, %s, %s, %s, %s,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                ON CONFLICT (code) DO NOTHING
            """, (code, name, river, state, lat, lon, bank_full, lon, lat))
    conn.commit()
    log.info("Inserted %d new gauge stations", len(new))
    return len(new)


def insert_met_stations(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT code FROM met_stations")
        existing = {r[0] for r in cur.fetchall()}

    new = [s for s in NEW_MET_STATIONS if s[0] not in existing]
    if not new:
        log.info("All met stations already present — skipping")
        return 0

    with conn.cursor() as cur:
        for code, name, lat, lon in new:
            cur.execute("""
                INSERT INTO met_stations (code, name, lat, lon, geom)
                VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                ON CONFLICT (code) DO NOTHING
            """, (code, name, lat, lon, lon, lat))
    conn.commit()
    log.info("Inserted %d new met stations", len(new))
    return len(new)


def summary(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM gauge_stations")
        n_gauge = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM met_stations")
        n_met = cur.fetchone()[0]
    log.info("Total: %d gauge stations, %d met stations", n_gauge, n_met)


if __name__ == "__main__":
    conn = psycopg2.connect(DB_DSN)
    g = insert_gauge_stations(conn)
    m = insert_met_stations(conn)
    summary(conn)
    conn.close()
    log.info("Done — added %d gauges, %d met stations", g, m)
