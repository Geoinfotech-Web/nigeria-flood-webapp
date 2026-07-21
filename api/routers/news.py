import asyncio
import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode
from xml.etree import ElementTree

import httpx
from fastapi import APIRouter, Query

router = APIRouter()

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = asyncio.Lock()
CACHE_SECONDS = 60

# State capitals and frequently reported flood locations.  Matching is done
# locally so a news click can focus the map without a second geocoding request.
NIGERIA_PLACES = {
    "abia": ("Abia", 5.5320, 7.4860), "umuahia": ("Umuahia", 5.5320, 7.4860),
    "adamawa": ("Adamawa", 9.3265, 12.3984), "yola": ("Yola", 9.2035, 12.4954),
    "akwa ibom": ("Akwa Ibom", 5.0377, 7.9128), "uyo": ("Uyo", 5.0377, 7.9128),
    "anambra": ("Anambra", 6.2101, 7.0741), "awka": ("Awka", 6.2101, 7.0741), "onitsha": ("Onitsha", 6.1443, 6.7885),
    "bauchi": ("Bauchi", 10.3158, 9.8442), "bayelsa": ("Bayelsa", 4.9267, 6.2676), "yenagoa": ("Yenagoa", 4.9267, 6.2676),
    "benue": ("Benue", 7.7322, 8.5391), "makurdi": ("Makurdi", 7.7322, 8.5391),
    "borno": ("Borno", 11.8333, 13.1500), "maiduguri": ("Maiduguri", 11.8333, 13.1500),
    "cross river": ("Cross River", 4.9757, 8.3417), "calabar": ("Calabar", 4.9757, 8.3417),
    "delta": ("Delta", 6.2059, 6.6959), "asaba": ("Asaba", 6.2059, 6.6959), "warri": ("Warri", 5.5167, 5.7500),
    "ebonyi": ("Ebonyi", 6.3249, 8.1137), "abakaliki": ("Abakaliki", 6.3249, 8.1137),
    "edo": ("Edo", 6.3350, 5.6037), "benin city": ("Benin City", 6.3350, 5.6037),
    "ekiti": ("Ekiti", 7.6210, 5.2215), "ado ekiti": ("Ado Ekiti", 7.6210, 5.2215),
    "enugu": ("Enugu", 6.4584, 7.5464), "gombe": ("Gombe", 10.2897, 11.1673),
    "imo": ("Imo", 5.4891, 7.0176), "owerri": ("Owerri", 5.4891, 7.0176),
    "jigawa": ("Jigawa", 11.7000, 9.3500), "dutse": ("Dutse", 11.7000, 9.3500),
    "kaduna": ("Kaduna", 10.5105, 7.4165), "kano": ("Kano", 12.0022, 8.5920),
    "katsina": ("Katsina", 12.9908, 7.6018), "kebbi": ("Kebbi", 12.4539, 4.1975), "birnin kebbi": ("Birnin Kebbi", 12.4539, 4.1975),
    "kogi": ("Kogi", 7.8023, 6.7333), "lokoja": ("Lokoja", 7.8023, 6.7333),
    "kwara": ("Kwara", 8.4966, 4.5421), "ilorin": ("Ilorin", 8.4966, 4.5421),
    "lagos": ("Lagos", 6.5244, 3.3792), "lekki": ("Lekki", 6.4698, 3.5852), "ikorodu": ("Ikorodu", 6.6194, 3.5105),
    "nasarawa": ("Nasarawa", 8.4904, 8.5153), "lafia": ("Lafia", 8.4904, 8.5153),
    "niger state": ("Niger State", 9.6139, 6.5569), "minna": ("Minna", 9.6139, 6.5569),
    "ogun": ("Ogun", 7.1475, 3.3619), "abeokuta": ("Abeokuta", 7.1475, 3.3619),
    "ondo": ("Ondo", 7.2571, 5.2058), "akure": ("Akure", 7.2571, 5.2058),
    "osun": ("Osun", 7.7827, 4.5418), "osogbo": ("Osogbo", 7.7827, 4.5418),
    "oyo": ("Oyo", 7.3775, 3.9470), "ibadan": ("Ibadan", 7.3775, 3.9470),
    "plateau": ("Plateau", 9.8965, 8.8583), "jos": ("Jos", 9.8965, 8.8583),
    "rivers state": ("Rivers State", 4.8156, 7.0498), "port harcourt": ("Port Harcourt", 4.8156, 7.0498),
    "sokoto": ("Sokoto", 13.0059, 5.2476), "taraba": ("Taraba", 8.8920, 11.3771), "jalingo": ("Jalingo", 8.8920, 11.3771),
    "yobe": ("Yobe", 11.7480, 11.9660), "damaturu": ("Damaturu", 11.7480, 11.9660),
    "zamfara": ("Zamfara", 12.1704, 6.6641), "gusau": ("Gusau", 12.1704, 6.6641),
    "abuja": ("Abuja", 9.0765, 7.3986), "fct": ("Federal Capital Territory", 9.0765, 7.3986),
}


def _normalise_place_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", value.casefold().replace("–", "-")).strip()


def _load_local_gazetteer() -> dict[str, tuple[str, float, float]]:
    """Load named Nigerian cities/towns already shipped with the dashboard."""
    places = dict(NIGERIA_PLACES)
    path = Path(__file__).resolve().parents[1] / "data" / "exposure_places.geojson"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for feature in payload.get("features", []):
            props = feature.get("properties") or {}
            if props.get("class") not in {"City", "Town"}:
                continue
            name = (props.get("name") or "").strip()
            coords = (feature.get("geometry") or {}).get("coordinates") or []
            alias = _normalise_place_name(name)
            if len(alias) < 4 or len(coords) < 2:
                continue
            places.setdefault(alias, (name, float(coords[1]), float(coords[0])))
    except (OSError, ValueError, TypeError):
        pass
    return places


PLACE_GAZETTEER = _load_local_gazetteer()


@router.get("")
async def live_flood_news(
    location: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=8, ge=1, le=20),
):
    location = (location or "").strip()
    key = location.lower() or "nigeria"
    now = time.monotonic()
    cached = _cache.get(key)
    if cached and now - cached[0] < CACHE_SECONDS:
        articles = cached[1]
        return _response(articles[:limit], location, cached=True)

    async with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < CACHE_SECONDS:
            return _response(cached[1][:limit], location, cached=True)

        query = f'("flood" OR "flooding" OR "river overflow") Nigeria'
        if location:
            query += f' "{location}"'
        params = {"q": query, "hl": "en-NG", "gl": "NG", "ceid": "NG:en"}
        url = f"{GOOGLE_NEWS_RSS}?{urlencode(params)}"

        try:
            async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
                response = await client.get(url, headers={"User-Agent": "NigeriaFloodDashboard/1.0"})
                response.raise_for_status()
            articles = _parse_feed(response.content)
            _cache[key] = (time.monotonic(), articles)
            return _response(articles[:limit], location, cached=False)
        except (httpx.HTTPError, ElementTree.ParseError):
            if cached:
                return _response(cached[1][:limit], location, cached=True, stale=True)
            return _response([], location, cached=False, unavailable=True)


def _parse_feed(content: bytes) -> list[dict]:
    root = ElementTree.fromstring(content)
    articles = []
    seen = set()
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link or link in seen:
            continue
        seen.add(link)
        source_node = item.find("source")
        source = (source_node.text or "Google News").strip() if source_node is not None else "Google News"
        source_url = (source_node.attrib.get("url") or "").strip() if source_node is not None else ""
        published_raw = (item.findtext("pubDate") or "").strip()
        try:
            published = parsedate_to_datetime(published_raw).astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError):
            published = None
        place = _match_place(title)
        image_url = _rss_image(item)
        articles.append({
            "title": title, "url": link, "source": source, "published_at": published,
            "location": place[0] if place else None,
            "lat": place[1] if place else None,
            "lon": place[2] if place else None,
            "location_source": "headline_gazetteer" if place else None,
            "location_confidence": 0.88 if place else None,
            "image_url": image_url,
            "image_kind": "report" if image_url else None,
        })
    return articles


def _match_place(title: str):
    text = _normalise_place_name(title)
    # Prefer longer, more precise names over their containing state/city names.
    for alias in sorted(PLACE_GAZETTEER, key=len, reverse=True):
        if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", text):
            return PLACE_GAZETTEER[alias]
    return None


def _rss_image(item) -> str | None:
    """Return media supplied by a feed without scraping the publisher page."""
    for child in item:
        tag = child.tag.rsplit("}", 1)[-1].casefold()
        if tag in {"thumbnail", "content"}:
            url = (child.attrib.get("url") or "").strip()
            medium = (child.attrib.get("medium") or "").casefold()
            content_type = (child.attrib.get("type") or "").casefold()
            if url and (tag == "thumbnail" or medium == "image" or content_type.startswith("image/")):
                return url
    return None


def _response(articles, location, **state):
    return {
        "articles": articles,
        "location": location or "Nigeria",
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        **state,
    }
