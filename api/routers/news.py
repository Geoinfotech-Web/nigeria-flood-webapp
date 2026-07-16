import asyncio
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode
from xml.etree import ElementTree

import httpx
from fastapi import APIRouter, Query

router = APIRouter()

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = asyncio.Lock()
CACHE_SECONDS = 60


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
        published_raw = (item.findtext("pubDate") or "").strip()
        try:
            published = parsedate_to_datetime(published_raw).astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError):
            published = None
        articles.append({"title": title, "url": link, "source": source, "published_at": published})
    return articles


def _response(articles, location, **state):
    return {
        "articles": articles,
        "location": location or "Nigeria",
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        **state,
    }
