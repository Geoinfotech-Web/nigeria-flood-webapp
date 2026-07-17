"""
Nigeria Flood Dashboard — PDF Documentation Generator
Generates a professional multi-page PDF using ReportLab.
Run: python generate_docs_pdf.py
Output: Nigeria_Flood_Dashboard_Documentation.pdf
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.platypus.flowables import Flowable
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon, Circle
from reportlab.graphics import renderPDF
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.lib.colors import HexColor
from datetime import date
import os

# ── Colour palette ──────────────────────────────────────────────────────────
C_BG        = HexColor("#0f172a")   # page background (not used on white paper)
C_BLUE      = HexColor("#3b82f6")
C_BLUE_DK   = HexColor("#1d4ed8")
C_CYAN      = HexColor("#06b6d4")
C_GREEN     = HexColor("#22c55e")
C_AMBER     = HexColor("#f59e0b")
C_RED       = HexColor("#ef4444")
C_SLATE     = HexColor("#1e293b")
C_SLATE2    = HexColor("#334155")
C_SLATE3    = HexColor("#475569")
C_SLATE_LT  = HexColor("#94a3b8")
C_WHITE     = HexColor("#ffffff")
C_GRAY_LT   = HexColor("#f1f5f9")
C_GRAY_MID  = HexColor("#e2e8f0")
C_TEXT      = HexColor("#1e293b")
C_TEXT2     = HexColor("#475569")
C_HEADER_BG = HexColor("#1e3a5f")

OUTPUT = os.path.join(os.path.dirname(__file__), "Nigeria_Flood_Dashboard_Documentation.pdf")

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


# ── Custom page template ─────────────────────────────────────────────────────

def on_page(canv, doc):
    """Draw header + footer on every page except cover."""
    pn = doc.page
    if pn == 1:
        return
    canv.saveState()
    # Top accent bar
    canv.setFillColor(C_BLUE)
    canv.rect(0, PAGE_H - 8 * mm, PAGE_W, 8 * mm, fill=1, stroke=0)
    canv.setFillColor(C_CYAN)
    canv.rect(0, PAGE_H - 8 * mm, 40 * mm, 8 * mm, fill=1, stroke=0)
    # Header text
    canv.setFillColor(C_WHITE)
    canv.setFont("Helvetica-Bold", 8)
    canv.drawString(MARGIN, PAGE_H - 5.5 * mm, "NIGERIA FLOOD PREDICTION DASHBOARD")
    canv.setFont("Helvetica", 8)
    canv.drawRightString(PAGE_W - MARGIN, PAGE_H - 5.5 * mm, "Technical Documentation  |  March 2026")
    # Bottom rule + page number
    canv.setStrokeColor(C_GRAY_MID)
    canv.setLineWidth(0.5)
    canv.line(MARGIN, 12 * mm, PAGE_W - MARGIN, 12 * mm)
    canv.setFillColor(C_TEXT2)
    canv.setFont("Helvetica", 8)
    canv.drawCentredString(PAGE_W / 2, 7 * mm, f"Page {pn}")
    canv.restoreState()


# ── Styles ────────────────────────────────────────────────────────────────────

def make_styles():
    base = getSampleStyleSheet()

    def S(name, **kw):
        return ParagraphStyle(name, **kw)

    return {
        "title": S("title",
            fontName="Helvetica-Bold", fontSize=32, textColor=C_WHITE,
            spaceAfter=6, leading=38, alignment=TA_LEFT),
        "subtitle": S("subtitle",
            fontName="Helvetica", fontSize=14, textColor=HexColor("#93c5fd"),
            spaceAfter=4, leading=18, alignment=TA_LEFT),
        "cover_meta": S("cover_meta",
            fontName="Helvetica", fontSize=10, textColor=HexColor("#cbd5e1"),
            leading=14, alignment=TA_LEFT),
        "h1": S("h1",
            fontName="Helvetica-Bold", fontSize=18, textColor=C_BLUE_DK,
            spaceBefore=14, spaceAfter=6, leading=22),
        "h2": S("h2",
            fontName="Helvetica-Bold", fontSize=13, textColor=C_SLATE,
            spaceBefore=10, spaceAfter=4, leading=16),
        "h3": S("h3",
            fontName="Helvetica-Bold", fontSize=11, textColor=C_SLATE2,
            spaceBefore=6, spaceAfter=3, leading=14),
        "body": S("body",
            fontName="Helvetica", fontSize=9.5, textColor=C_TEXT,
            leading=14, spaceAfter=4),
        "body_sm": S("body_sm",
            fontName="Helvetica", fontSize=8.5, textColor=C_TEXT2,
            leading=12, spaceAfter=3),
        "code": S("code",
            fontName="Courier", fontSize=8, textColor=C_SLATE,
            leading=11, backColor=C_GRAY_LT, leftIndent=8, rightIndent=8,
            spaceAfter=3),
        "bullet": S("bullet",
            fontName="Helvetica", fontSize=9.5, textColor=C_TEXT,
            leading=14, leftIndent=14, spaceAfter=2,
            bulletIndent=4, bulletFontName="Helvetica", bulletFontSize=9.5),
        "th": S("th",
            fontName="Helvetica-Bold", fontSize=8.5, textColor=C_WHITE,
            leading=11, alignment=TA_LEFT),
        "td": S("td",
            fontName="Helvetica", fontSize=8.5, textColor=C_TEXT,
            leading=11, alignment=TA_LEFT),
        "td_code": S("td_code",
            fontName="Courier", fontSize=8, textColor=C_BLUE_DK,
            leading=11, alignment=TA_LEFT),
        "toc_h1": S("toc_h1",
            fontName="Helvetica-Bold", fontSize=10, textColor=C_TEXT,
            leading=14, leftIndent=0),
        "toc_h2": S("toc_h2",
            fontName="Helvetica", fontSize=9.5, textColor=C_TEXT2,
            leading=13, leftIndent=12),
        "caption": S("caption",
            fontName="Helvetica-Oblique", fontSize=8.5, textColor=C_TEXT2,
            alignment=TA_CENTER, spaceBefore=2, spaceAfter=8),
        "metric_val": S("metric_val",
            fontName="Helvetica-Bold", fontSize=20, textColor=C_BLUE,
            leading=24, alignment=TA_CENTER),
        "metric_lbl": S("metric_lbl",
            fontName="Helvetica", fontSize=8, textColor=C_TEXT2,
            leading=10, alignment=TA_CENTER),
    }


# ── Helper flowables ──────────────────────────────────────────────────────────

def section_rule(c_left=C_BLUE, c_right=C_GRAY_MID):
    return HRFlowable(width="100%", thickness=2, color=c_left, spaceAfter=6, spaceBefore=2)


def color_badge(text, bg=C_BLUE, fg=C_WHITE, styles=None):
    """Inline badge via a tiny 1-cell table."""
    s = styles or make_styles()
    p = Paragraph(f'<font color="white"><b>{text}</b></font>',
                  ParagraphStyle("badge", fontName="Helvetica-Bold", fontSize=8,
                                 textColor=fg, leading=10))
    t = Table([[p]], colWidths=[len(text) * 5.5 + 10])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("ROUNDEDCORNERS", [3, 3, 3, 3]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


def info_box(text, style, bg=C_GRAY_LT, border=C_BLUE):
    p = Paragraph(text, style)
    t = Table([[p]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEAFTER", (0, 0), (0, -1), 0, border),  # invisible
        ("BOX", (0, 0), (-1, -1), 0.5, border),
        ("LINEBEFORE", (0, 0), (0, -1), 3, border),
    ]))
    return t


def make_table(headers, rows, styles, col_widths=None, header_bg=C_HEADER_BG):
    s = styles
    header_cells = [Paragraph(h, s["th"]) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([
            Paragraph(str(cell), s["td_code"] if i == 0 else s["td"])
            for i, cell in enumerate(row)
        ])
    if col_widths is None:
        col_widths = [CONTENT_W / len(headers)] * len(headers)
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_GRAY_LT]),
        ("GRID", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
        ("LINEBELOW", (0, 0), (-1, 0), 1, C_BLUE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ])
    t.setStyle(style)
    return t


# ── Architecture diagram (drawn with ReportLab graphics) ─────────────────────

class ArchDiagram(Flowable):
    W = CONTENT_W
    H = 185 * mm

    def wrap(self, aw, ah):
        return self.W, self.H

    def draw(self):
        c = self.canv
        w, h = self.W, self.H

        BOX_W = w * 0.78
        BOX_X = (w - BOX_W) / 2
        ROW_H = 22 * mm
        GAP   = 6 * mm
        rows = [
            ("DATA SOURCES", "#1e3a5f",
             "OpenMeteo Flood API (GloFAS)  ·  OpenMeteo Weather API\n"
             "Google Earth Engine (JRC+SRTM)  ·  Sentinel-1 SAR  ·  Synthetic fallback"),
            ("INGEST  (Python · APScheduler)", "#1a3a2a",
             "real_data.py  ·  backfill.py  ·  expand_stations.py\n"
             "gee_flood_risk.py  ·  sentinel1_flood.py  ·  synthetic_flood_risk.py"),
            ("TIMESCALEDB + PostGIS", "#1e293b",
             "Hypertables: gauge_readings · met_readings · flood_features · flood_predictions\n"
             "Spatial: flood_risk_areas · flood_risk_tiles"),
            ("FLINK FEATURE JOB  (standalone, 30s poll)", "#1a1a3a",
             "9 engineered features per station  →  flood_features hypertable"),
            ("ML TRAINING  (XGBoost + LSTM · 5 horizons)", "#2a1a3a",
             "7 registered models  ·  57,464 training rows  ·  AUC up to 0.9828"),
            ("BENTOML  SERVING  (port 3000)", "#1a2a3a",
             "XGB + LSTM ensemble  ·  POST /predict  →  flood_prob per horizon"),
            ("FASTAPI  (port 8000)", "#1a3a3a",
             "14 REST endpoints  ·  2 WebSocket streams  ·  Redis cache  ·  JWT auth"),
            ("REACT FRONTEND  (port 5173 · Vite + Tailwind)", "#1a2a1a",
             "MapLibre GL  ·  ECharts  ·  WebSocket live feed  ·  GEE / SAR tile overlay"),
        ]

        BOX_COLORS = [
            HexColor("#1e3a5f"), HexColor("#14532d"), HexColor("#1e293b"),
            HexColor("#1e1b4b"), HexColor("#3b0764"), HexColor("#0c4a6e"),
            HexColor("#134e4a"), HexColor("#14532d"),
        ]
        TEXT_COLORS = [
            HexColor("#93c5fd"), HexColor("#86efac"), HexColor("#94a3b8"),
            HexColor("#a5b4fc"), HexColor("#d8b4fe"), HexColor("#7dd3fc"),
            HexColor("#5eead4"), HexColor("#86efac"),
        ]
        LABEL_COLORS = [
            HexColor("#60a5fa"), HexColor("#4ade80"), HexColor("#64748b"),
            HexColor("#818cf8"), HexColor("#c084fc"), HexColor("#38bdf8"),
            HexColor("#2dd4bf"), HexColor("#4ade80"),
        ]

        total_h = len(rows) * ROW_H + (len(rows) - 1) * GAP
        y_start = h - (h - total_h) / 2 - ROW_H

        for i, (label, _, desc) in enumerate(rows):
            y = y_start - i * (ROW_H + GAP)
            bg = BOX_COLORS[i]
            tc = TEXT_COLORS[i]
            lc = LABEL_COLORS[i]

            # Box
            c.setFillColor(bg)
            c.roundRect(BOX_X, y, BOX_W, ROW_H, 3, fill=1, stroke=0)
            # Left accent bar
            c.setFillColor(lc)
            c.roundRect(BOX_X, y, 4, ROW_H, 2, fill=1, stroke=0)

            # Label
            c.setFillColor(lc)
            c.setFont("Helvetica-Bold", 8)
            c.drawString(BOX_X + 10, y + ROW_H - 8, label)

            # Description
            c.setFillColor(tc)
            c.setFont("Helvetica", 7)
            lines = desc.split("\n")
            for j, line in enumerate(lines):
                c.drawString(BOX_X + 10, y + ROW_H - 17 - j * 9, line)

            # Arrow down (except last)
            if i < len(rows) - 1:
                ax = BOX_X + BOX_W / 2
                ay = y - GAP / 2
                c.setStrokeColor(HexColor("#475569"))
                c.setFillColor(HexColor("#475569"))
                c.setLineWidth(1)
                c.line(ax, y, ax, y - GAP + 3)
                # arrowhead
                c.setFillColor(HexColor("#475569"))
                pts = [ax - 4, ay + 4, ax + 4, ay + 4, ax, ay - 1]
                p = c.beginPath()
                p.moveTo(pts[0], pts[1])
                p.lineTo(pts[2], pts[3])
                p.lineTo(pts[4], pts[5])
                p.close()
                c.drawPath(p, fill=1, stroke=0)


# ── Metric cards row ──────────────────────────────────────────────────────────

def metric_cards(metrics, styles):
    """metrics = list of (value, label, color)"""
    cell_w = CONTENT_W / len(metrics)
    row = []
    for val, lbl, col in metrics:
        inner = [
            [Paragraph(val, ParagraphStyle("mv", fontName="Helvetica-Bold",
                       fontSize=22, textColor=col, leading=26, alignment=TA_CENTER))],
            [Paragraph(lbl, ParagraphStyle("ml", fontName="Helvetica",
                       fontSize=8, textColor=C_TEXT2, leading=10, alignment=TA_CENTER))],
        ]
        card = Table(inner, colWidths=[cell_w - 8])
        card.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), C_GRAY_LT),
            ("BOX", (0, 0), (-1, -1), 0.5, C_GRAY_MID),
            ("LINEABOVE", (0, 0), (-1, 0), 2.5, col),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        row.append(card)
    outer = Table([row], colWidths=[cell_w] * len(metrics))
    outer.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return outer


# ── Cover page ────────────────────────────────────────────────────────────────

def draw_cover(canv, doc):
    canv.saveState()
    w, h = PAGE_W, PAGE_H

    # Dark background
    canv.setFillColor(HexColor("#0f172a"))
    canv.rect(0, 0, w, h, fill=1, stroke=0)

    # Decorative gradient band (simulate with rectangles)
    band_colors = [
        HexColor("#1e3a5f"), HexColor("#1a3050"), HexColor("#152540"),
        HexColor("#112035"), HexColor("#0f1a2a"),
    ]
    band_h = h * 0.55
    for i, bc in enumerate(band_colors):
        canv.setFillColor(bc)
        canv.rect(0, h - band_h + i * (band_h / len(band_colors)),
                  w, band_h / len(band_colors) + 1, fill=1, stroke=0)

    # Accent line at top
    canv.setFillColor(HexColor("#3b82f6"))
    canv.rect(0, h - 5, w, 5, fill=1, stroke=0)
    canv.setFillColor(HexColor("#06b6d4"))
    canv.rect(0, h - 5, w * 0.3, 5, fill=1, stroke=0)

    # Wave-like decorative arc
    canv.setStrokeColor(HexColor("#1d4ed8"))
    canv.setLineWidth(60)
    canv.setFillColorRGB(0, 0, 0, 0)
    canv.arc(-50, h * 0.3, w * 0.6, h * 1.2, startAng=200, extent=80)

    canv.setStrokeColor(HexColor("#0c4a6e"))
    canv.setLineWidth(40)
    canv.arc(w * 0.1, h * 0.2, w * 0.9, h * 1.1, startAng=210, extent=70)

    # Nigeria map silhouette dots (simplified scatter)
    canv.setFillColor(HexColor("#1e3a5f"))
    import random
    random.seed(42)
    for _ in range(120):
        x = random.uniform(w * 0.05, w * 0.95)
        y = random.uniform(h * 0.05, h * 0.45)
        r = random.uniform(1, 3)
        canv.circle(x, y, r, fill=1, stroke=0)

    canv.setFillColor(HexColor("#3b82f6"))
    for _ in range(30):
        x = random.uniform(w * 0.1, w * 0.9)
        y = random.uniform(h * 0.08, h * 0.42)
        r = random.uniform(0.5, 2)
        canv.circle(x, y, r, fill=1, stroke=0)

    # Bottom content band
    canv.setFillColor(HexColor("#0a0f1e"))
    canv.rect(0, 0, w, h * 0.42, fill=1, stroke=0)

    # Divider line
    canv.setStrokeColor(HexColor("#3b82f6"))
    canv.setLineWidth(1.5)
    canv.line(MARGIN, h * 0.42, w - MARGIN, h * 0.42)

    # Title block
    ty = h * 0.52
    canv.setFillColor(HexColor("#ffffff"))
    canv.setFont("Helvetica-Bold", 36)
    canv.drawString(MARGIN, ty + 60, "NIGERIA FLOOD")
    canv.drawString(MARGIN, ty + 18, "PREDICTION DASHBOARD")
    canv.setFillColor(HexColor("#93c5fd"))
    canv.setFont("Helvetica", 15)
    canv.drawString(MARGIN, ty - 10, "Technical Documentation & System Architecture")

    # Accent underline
    canv.setStrokeColor(HexColor("#06b6d4"))
    canv.setLineWidth(2.5)
    canv.line(MARGIN, ty - 18, MARGIN + 120, ty - 18)

    # Meta section
    meta_y = h * 0.35
    meta_items = [
        ("Version", "2.0  ·  March 2026"),
        ("Stack", "TimescaleDB · Flink · BentoML · FastAPI · React"),
        ("Coverage", "26 Gauge Stations · 29 Met Stations · All Major River Basins"),
        ("ML Models", "7 Registered  ·  XGBoost + LSTM  ·  AUC up to 0.9828"),
    ]
    canv.setFont("Helvetica-Bold", 8.5)
    canv.setFillColor(HexColor("#3b82f6"))
    canv.setFont("Helvetica", 8.5)
    canv.setFillColor(HexColor("#64748b"))
    for i, (key, val) in enumerate(meta_items):
        y = meta_y - i * 14
        canv.setFont("Helvetica-Bold", 8.5)
        canv.setFillColor(HexColor("#60a5fa"))
        canv.drawString(MARGIN, y, key.upper())
        canv.setFont("Helvetica", 8.5)
        canv.setFillColor(HexColor("#cbd5e1"))
        canv.drawString(MARGIN + 58, y, val)

    # Badge row
    badge_y = meta_y - len(meta_items) * 14 - 15
    badges = [
        ("GloFAS", HexColor("#1d4ed8")),
        ("Google Earth Engine", HexColor("#14532d")),
        ("Sentinel-1 SAR", HexColor("#7c3aed")),
        ("OpenMeteo", HexColor("#0369a1")),
        ("Open Source", HexColor("#065f46")),
    ]
    bx = MARGIN
    for txt, bg in badges:
        bw = len(txt) * 5.8 + 12
        canv.setFillColor(bg)
        canv.roundRect(bx, badge_y, bw, 12, 3, fill=1, stroke=0)
        canv.setFillColor(C_WHITE)
        canv.setFont("Helvetica-Bold", 6.5)
        canv.drawString(bx + 6, badge_y + 3.5, txt)
        bx += bw + 5

    # Footer
    canv.setFillColor(HexColor("#334155"))
    canv.setFont("Helvetica", 8)
    canv.drawString(MARGIN, 15, "Confidential — Internal Development Documentation")
    canv.drawRightString(w - MARGIN, 15, "© 2026 Nigeria Flood Dashboard Project")

    canv.restoreState()


# ── Main build ────────────────────────────────────────────────────────────────

def build():
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=22 * mm, bottomMargin=20 * mm,
        title="Nigeria Flood Dashboard — Technical Documentation",
        author="Nigeria Flood Dashboard Project",
        subject="System Architecture & Developer Reference",
    )
    S = make_styles()
    story = []

    # ── COVER (blank frame — drawn by onFirstPage canvas callback) ────────────
    # The cover is drawn entirely by draw_cover(); we just need a PageBreak
    # to push the Table of Contents onto page 2.
    story.append(PageBreak())

    # ── TABLE OF CONTENTS ─────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("Table of Contents", S["h1"]))
    story.append(section_rule())
    story.append(Spacer(1, 4))

    toc_entries = [
        ("1", "System Overview", True),
        ("2", "Architecture", True),
        ("", "Data Flow Diagram", False),
        ("", "Service Inventory", False),
        ("3", "Station Network", True),
        ("", "Gauge Stations (26)", False),
        ("", "Meteorological Stations (29)", False),
        ("4", "Database Schema", True),
        ("", "Hypertables", False),
        ("", "Spatial Tables", False),
        ("", "Continuous Aggregates", False),
        ("5", "Machine Learning Pipeline", True),
        ("", "Feature Engineering", False),
        ("", "Model Architecture", False),
        ("", "Registered Models & Performance", False),
        ("", "Risk Tiers", False),
        ("6", "Flood Risk Map", True),
        ("", "State-Level Risk (Synthetic)", False),
        ("", "GEE JRC + SRTM Composite", False),
        ("", "Sentinel-1 SAR Flood Detection", False),
        ("7", "API Reference", True),
        ("", "REST Endpoints", False),
        ("", "WebSocket Streams", False),
        ("8", "Frontend", True),
        ("9", "Data Sources", True),
        ("10", "Setup & Operations", True),
        ("11", "Known Limitations & Roadmap", True),
    ]
    for num, title, is_h1 in toc_entries:
        prefix = f"{num}.  " if num else "      "
        sty = S["toc_h1"] if is_h1 else S["toc_h2"]
        story.append(Paragraph(prefix + title, sty))
        if is_h1:
            story.append(Spacer(1, 2))

    # ── 1. SYSTEM OVERVIEW ────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("1.  System Overview", S["h1"]))
    story.append(section_rule())

    story.append(Paragraph(
        "The Nigeria Flood Prediction Dashboard is a full-stack geospatial intelligence platform "
        "that provides real-time flood monitoring and probabilistic forecasting across all major "
        "Nigerian river basins. The system fuses live hydrological and meteorological data with "
        "satellite-derived flood extent information to produce actionable flood risk intelligence "
        "at 6, 12, 24, 48, and 72-hour horizons.", S["body"]))

    story.append(Spacer(1, 6))
    story.append(metric_cards([
        ("26", "Gauge Stations", C_BLUE),
        ("29", "Met Stations", C_CYAN),
        ("7", "ML Models\nRegistered", C_GREEN),
        ("57,464", "Training\nRows", C_AMBER),
        ("5", "Forecast\nHorizons", HexColor("#8b5cf6")),
        ("0.9828", "Best AUC-ROC\n(XGB 6h)", C_RED),
    ], S))

    story.append(Spacer(1, 10))
    story.append(Paragraph("Key Capabilities", S["h2"]))
    caps = [
        ("Real-time hydrological monitoring",
         "River discharge from GloFAS (OpenMeteo Flood API) and rainfall from NWP "
         "models at 26 gauge stations across Niger, Benue, Kaduna, Cross River, Anambra, "
         "Ogun, Hadejia, Yobe, Sokoto/Rima, Gongola, Osun, Imo, and Zamfara river basins."),
        ("Machine learning flood forecasting",
         "XGBoost and LSTM models trained on 57,464 feature rows. True ensemble (both "
         "models registered) for the 48h and 72h horizons. XGBoost alone for 6h–24h "
         "where LSTM did not meet the quality gate on the current dataset."),
        ("Satellite flood intelligence",
         "Monthly GEE composite from JRC Global Surface Water + SRTM elevation/slope "
         "data. On-demand Sentinel-1 SAR change detection for active flood extent mapping. "
         "All rasters delivered as Cloud Optimised GeoTIFFs via TiTiler tile server."),
        ("Interactive map dashboard",
         "MapLibre GL JS frontend with flood risk polygon overlay, basemap switching "
         "(Dark/Light/Streets/Satellite/Topo), real-time station markers, ECharts time-series "
         "charts, WebSocket live updates, and Nominatim geocoding search."),
        ("API-first architecture",
         "FastAPI backend with 14 REST endpoints and 2 WebSocket streams. Redis caching, "
         "JWT authentication, asyncpg connection pooling. All satellite tile URLs proxied "
         "through the API so no Docker-internal hostnames are exposed to the browser."),
    ]
    for title, desc in caps:
        row = Table([[
            Paragraph(f"<b>{title}</b>", S["body"]),
            Paragraph(desc, S["body_sm"]),
        ]], colWidths=[52 * mm, CONTENT_W - 52 * mm])
        row.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), C_GRAY_LT),
            ("BACKGROUND", (1, 0), (1, 0), C_WHITE),
            ("BOX", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LINEBEFORE", (0, 0), (0, -1), 3, C_BLUE),
        ]))
        story.append(row)
        story.append(Spacer(1, 3))

    # ── 2. ARCHITECTURE ────────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("2.  Architecture", S["h1"]))
    story.append(section_rule())
    story.append(Paragraph("Data Flow Diagram", S["h2"]))
    story.append(Paragraph(
        "Data originates from free public APIs (OpenMeteo, GloFAS) and Google Earth Engine "
        "satellite imagery. It flows through Python ingest scripts into TimescaleDB, through "
        "the Flink feature job, into ML training, and is finally served by FastAPI to the "
        "React frontend via REST and WebSocket.", S["body"]))
    story.append(Spacer(1, 6))
    story.append(ArchDiagram())
    story.append(Paragraph("Figure 1 — System data flow (top to bottom)", S["caption"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Service Inventory", S["h2"]))
    svc_headers = ["Container", "Port", "Technology", "Role"]
    svc_rows = [
        ("flood_timescaledb",  "5432",      "TimescaleDB PG16 + PostGIS",  "Time-series & spatial storage"),
        ("flood_redis",        "6379",      "Redis 7",                      "API response caching"),
        ("flood_minio",        "9000/9001", "MinIO",                        "MLflow artifacts, COG rasters"),
        ("flood_flink_*",      "8081",      "Apache Flink 1.18",            "Feature engineering (standalone)"),
        ("flood_mlflow",       "5000",      "MLflow",                       "Experiment tracking & model registry"),
        ("flood_bentoml",      "3000",      "BentoML",                      "XGBoost + LSTM inference"),
        ("flood_ingest",       "—",         "Python + APScheduler",         "Gauge & met data fetching"),
        ("flood_api",          "8000",      "FastAPI + asyncpg",            "REST + WebSocket backend"),
        ("flood_frontend",     "5173",      "React + Vite + Tailwind",      "Dashboard UI"),
        ("flood_titiler",      "8888",      "TiTiler",                      "COG → XYZ map tiles"),
        ("flood_prometheus",   "9090",      "Prometheus",                   "API metrics scraping"),
        ("flood_grafana",      "3001",      "Grafana",                      "Ops monitoring dashboards"),
    ]
    story.append(make_table(svc_headers, svc_rows, S,
                            col_widths=[44*mm, 22*mm, 52*mm, CONTENT_W - 44*mm - 22*mm - 52*mm]))

    # ── 3. STATION NETWORK ────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("3.  Station Network", S["h1"]))
    story.append(section_rule())
    story.append(info_box(
        "All station coordinates are stored in the database. The ingest script "
        "<font name='Courier' size=9>real_data.py</font> reads stations dynamically — "
        "no coordinates are hardcoded. Adding a row to <font name='Courier' size=9>gauge_stations</font> "
        "is sufficient to include a new station in the next ingest cycle.", S["body"], C_GRAY_LT, C_CYAN))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Gauge Stations (26 total)", S["h2"]))
    story.append(Paragraph(
        "Covers all major Nigerian river basins, expanded from 5 to 26 stations in March 2026 "
        "using <font name='Courier' size=9>ingest/expand_stations.py</font>.", S["body"]))
    story.append(Spacer(1, 4))
    g_headers = ["Code", "Name", "River", "State", "Bank-full (m)"]
    g_rows = [
        ("BENUE_LOK",   "Lokoja Confluence",  "Benue/Niger",    "Kogi",        "12.5"),
        ("NIGER_OHO",   "Ohoror",             "Niger",          "Delta",       "10.8"),
        ("ANAMBRA_OS",  "Onitsha Gauge",      "Niger",          "Anambra",     "9.2"),
        ("KADUNA_ZAR",  "Zaria Gauge",        "Kaduna",         "Kaduna",      "5.6"),
        ("SOKOTO_BIR",  "Birnin Kebbi",       "Sokoto",         "Kebbi",       "7.1"),
        ("NIGER_JEB",   "Jebba Dam",          "Niger",          "Kwara",       "15.0"),
        ("NIGER_KAI",   "Kainji Downstream",  "Niger",          "Niger",       "16.5"),
        ("NIGER_IDA",   "Idah Crossing",      "Niger",          "Kogi",        "13.5"),
        ("NIGER_ASA",   "Asaba",              "Niger",          "Delta",       "11.0"),
        ("BENUE_MAK",   "Makurdi",            "Benue",          "Benue",       "11.5"),
        ("BENUE_IBI",   "Ibi",                "Benue",          "Taraba",      "9.0"),
        ("BENUE_NUM",   "Numan",              "Benue",          "Adamawa",     "8.5"),
        ("KADUNA_SHI",  "Shiroro Dam",        "Kaduna",         "Niger",       "7.5"),
        ("KADUNA_KAD",  "Kaduna City",        "Kaduna",         "Kaduna",      "6.5"),
        ("CROSS_IKO",   "Ikom",               "Cross River",    "Cross River", "8.5"),
        ("CROSS_CAL",   "Calabar",            "Cross River",    "Cross River", "7.0"),
        ("ANAM_OTU",    "Otuocha",            "Anambra",        "Anambra",     "8.0"),
        ("OGUN_ABE",    "Abeokuta",           "Ogun",           "Ogun",        "6.0"),
        ("HADEJIA_HAD", "Hadejia",            "Hadejia",        "Jigawa",      "4.5"),
        ("YOBE_GAS",    "Gashua",             "Komadugu Yobe",  "Yobe",        "4.0"),
        ("SOKOTO_ARG",  "Argungu",            "Rima",           "Kebbi",       "5.5"),
        ("GONG_YOL",    "Yola",               "Benue/Gongola",  "Adamawa",     "7.5"),
        ("OSUN_OSO",    "Osogbo",             "Osun",           "Osun",        "5.0"),
        ("IMO_OWE",     "Owerri",             "Imo",            "Imo",         "4.5"),
        ("ZAMFARA_GUS", "Gusau",              "Zamfara",        "Zamfara",     "4.0"),
        ("KATALA_TAK",  "Takum",              "Katsina Ala",    "Taraba",      "6.5"),
    ]
    story.append(make_table(g_headers, g_rows, S,
                            col_widths=[32*mm, 38*mm, 34*mm, 32*mm, CONTENT_W-136*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Met Station Coverage (29 total)", S["h2"]))
    story.append(Paragraph(
        "One OpenMeteo sampling point per gauge catchment, plus four original NIMET reference "
        "stations and five strategic city stations for better northern/coastal coverage.", S["body"]))
    met_groups = [
        ("Original NIMET (4)", "Abuja, Ibadan, Kano Airport, Port Harcourt International"),
        ("Gauge catchment points (20)", "Jebba, Kainji, Idah, Asaba, Makurdi, Ibi, Numan, "
         "Shiroro, Ikom, Calabar, Otuocha, Abeokuta, Hadejia, Gashua, Argungu, Yola, "
         "Osogbo, Owerri, Gusau, Takum"),
        ("Strategic cities (5)", "Maiduguri, Sokoto City, Benin City, Enugu, Kaduna City"),
    ]
    for grp, members in met_groups:
        t = Table([[
            Paragraph(grp, S["body"]),
            Paragraph(members, S["body_sm"]),
        ]], colWidths=[48*mm, CONTENT_W - 48*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), C_GRAY_LT),
            ("BOX", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBEFORE", (0, 0), (0, -1), 3, C_CYAN),
        ]))
        story.append(t)
        story.append(Spacer(1, 2))

    # ── 4. DATABASE SCHEMA ────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("4.  Database Schema", S["h1"]))
    story.append(section_rule())

    story.append(Paragraph("Hypertables", S["h2"]))
    ht_headers = ["Table", "Interval", "Key Columns"]
    ht_rows = [
        ("gauge_readings",   "5 min",   "time, station_id, water_level_m, flow_rate_m3s"),
        ("met_readings",     "15 min",  "time, station_id, rainfall_mm, temperature_c, humidity_pct, wind_speed_ms, pressure_hpa"),
        ("flood_features",   "30 s",    "time, station_id, water_level_m, flow_rate_m3s, level_change_1h, level_change_3h, rolling_rain_3h_mm, rolling_rain_24h_mm, soil_moisture_idx, days_since_last_peak, level_pct_bank"),
        ("flood_predictions","on demand","time, station_id, horizon_h, flood_prob, xgb_prob, lstm_prob, risk_tier"),
    ]
    story.append(make_table(ht_headers, ht_rows, S,
                            col_widths=[36*mm, 22*mm, CONTENT_W - 58*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Reference Tables", S["h2"]))
    ref_rows = [
        ("gauge_stations",   "id, code, name, river, state, lat, lon, bank_full_m, geom"),
        ("met_stations",     "id, code, name, lat, lon, geom"),
        ("alert_log",        "id, station_id, horizon_h, risk_tier, flood_prob, created_at"),
        ("flood_risk_areas", "id, name, state, geom (MultiPolygon), risk_score, risk_tier, source, valid_from, valid_to"),
        ("flood_risk_tiles", "id, name, source, cog_url, tile_url, created_at"),
    ]
    story.append(make_table(["Table", "Key Columns"], ref_rows, S,
                            col_widths=[38*mm, CONTENT_W - 38*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Continuous Aggregates", S["h2"]))
    agg_rows = [
        ("gauge_hourly",   "1 hour", "avg_level_m, max_level_m, avg_flow_m3s"),
        ("rainfall_daily", "1 day",  "total_rain_mm, max_rain_mm"),
    ]
    story.append(make_table(["Aggregate View", "Bucket Size", "Columns"], agg_rows, S,
                            col_widths=[44*mm, 28*mm, CONTENT_W - 72*mm]))

    # ── 5. ML PIPELINE ────────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("5.  Machine Learning Pipeline", S["h1"]))
    story.append(section_rule())

    story.append(Paragraph("Feature Engineering", S["h2"]))
    story.append(Paragraph(
        "Computed by <font name='Courier' size=9>flink/jobs/flood_features.py</font> every "
        "30 seconds per station. All features written to the <font name='Courier' size=9>flood_features</font> "
        "hypertable.", S["body"]))
    story.append(Spacer(1, 4))
    feat_headers = ["Feature", "Formula / Source"]
    feat_rows = [
        ("water_level_m",         "Raw gauge reading (metres)"),
        ("flow_rate_m3s",         "Raw gauge reading (m³/s)"),
        ("level_change_1h",       "level_now − level_1h_ago"),
        ("level_change_3h",       "level_now − level_3h_ago"),
        ("rolling_rain_3h_mm",    "Sum of all met station rainfall in last 3 hours"),
        ("rolling_rain_24h_mm",   "Sum of all met station rainfall in last 24 hours"),
        ("soil_moisture_idx",     "min(1.0, rain_24h ÷ 80)  — catchment saturation proxy"),
        ("days_since_last_peak",  "Days since water level last exceeded 85 % of bank-full"),
        ("level_pct_bank",        "water_level_m ÷ bank_full_m"),
    ]
    story.append(make_table(feat_headers, feat_rows, S,
                            col_widths=[52*mm, CONTENT_W - 52*mm]))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Flood label:</b>  A sample is labelled positive if "
        "<font name='Courier' size=9>water_level_m &gt; 0.80 × bank_full_m</font> at any point "
        "within the next N hours (N = forecast horizon).", S["body"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Model Architecture", S["h2"]))
    arch_tbl = [
        [Paragraph("<b>XGBoost</b>", S["body"]),
         Paragraph(
            "300 estimators · max depth 6 · learning rate 0.05\n"
            "scale_pos_weight auto-set from class imbalance\n"
            "Train/test split: stratified random 80/20\n"
            "Decision threshold: ROC-optimal (not fixed 0.5)", S["body_sm"])],
        [Paragraph("<b>LSTM</b>", S["body"]),
         Paragraph(
            "2 layers · 64 hidden units · 0.3 dropout\n"
            "Input: 12-step sequences (~6 hours of history)\n"
            "Train/test split: per-station temporal 80/20\n"
            "Optimizer: Adam · Loss: BCE · Epochs: 30", S["body_sm"])],
        [Paragraph("<b>Ensemble</b>", S["body"]),
         Paragraph(
            "flood_prob = (xgb_prob + lstm_prob) / 2\n"
            "Falls back to single model if only one passes quality gate", S["body_sm"])],
    ]
    at = Table(arch_tbl, colWidths=[30*mm, CONTENT_W - 30*mm])
    at.setStyle(TableStyle([
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [C_GRAY_LT, C_WHITE, C_GRAY_LT]),
        ("GRID", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
        ("LINEBEFORE", (0, 0), (0, -1), 3, C_BLUE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(at)

    story.append(Spacer(1, 8))
    story.append(Paragraph("Registered Models & Performance", S["h2"]))
    story.append(Paragraph(
        "Last training run: March 2026 · 57,464 rows · 26 gauge stations. "
        "Quality gate: AUC-ROC ≥ 0.80, F1 ≥ 0.60.", S["body"]))
    story.append(Spacer(1, 4))

    model_headers = ["BentoML Tag", "Type", "Horizon", "AUC-ROC", "F1", "Threshold", "Positive Rate"]
    model_rows = [
        ("xgb_h6",   "XGBoost", "6h",  "0.9828", "0.8073", "0.602", "8.1%"),
        ("xgb_h12",  "XGBoost", "12h", "0.9595", "0.7481", "0.598", "14.4%"),
        ("xgb_h24",  "XGBoost", "24h", "0.9207", "0.7291", "0.536", "25.4%"),
        ("xgb_h48",  "XGBoost", "48h", "0.9184", "0.8110", "0.502", "42.1%"),
        ("lstm_h48", "LSTM",    "48h", "0.8013", "0.6960", "—",     "42.1%"),
        ("xgb_h72",  "XGBoost", "72h", "0.9373", "0.8777", "0.516", "53.0%"),
        ("lstm_h72", "LSTM",    "72h", "0.8398", "0.7939", "—",     "53.0%"),
    ]
    mt = make_table(model_headers, model_rows, S,
                    col_widths=[28*mm, 22*mm, 18*mm, 22*mm, 18*mm, 22*mm,
                                CONTENT_W - 130*mm])
    story.append(mt)

    story.append(Spacer(1, 8))
    story.append(Paragraph("Risk Tiers", S["h2"]))
    tier_data = [
        [Paragraph("Tier", S["th"]),
         Paragraph("Flood Probability", S["th"]),
         Paragraph("Colour", S["th"]),
         Paragraph("Recommended Action", S["th"])],
        [Paragraph("Normal", S["td"]),   Paragraph("< 25%",   S["td"]), Paragraph("Green",  S["td"]), Paragraph("No action required",           S["td"])],
        [Paragraph("Watch",  S["td"]),   Paragraph("25–50%",  S["td"]), Paragraph("Yellow", S["td"]), Paragraph("Monitor; alert communities",    S["td"])],
        [Paragraph("Warning",S["td"]),   Paragraph("50–75%",  S["td"]), Paragraph("Orange", S["td"]), Paragraph("Prepare evacuation plans",      S["td"])],
        [Paragraph("Emergency",S["td"]), Paragraph("> 75%",   S["td"]), Paragraph("Red",    S["td"]), Paragraph("Initiate evacuation",           S["td"])],
    ]
    tier_t = Table(tier_data, colWidths=[30*mm, 36*mm, 28*mm, CONTENT_W - 94*mm])
    tier_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), C_HEADER_BG),
        ("BACKGROUND", (0, 1), (-1, 1), HexColor("#dcfce7")),
        ("BACKGROUND", (0, 2), (-1, 2), HexColor("#fef9c3")),
        ("BACKGROUND", (0, 3), (-1, 3), HexColor("#ffedd5")),
        ("BACKGROUND", (0, 4), (-1, 4), HexColor("#fee2e2")),
        ("GRID", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(tier_t)

    # ── 6. FLOOD RISK MAP ─────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("6.  Flood Risk Map", S["h1"]))
    story.append(section_rule())

    story.append(Paragraph("State-Level Risk (Synthetic / Fallback)", S["h2"]))
    story.append(Paragraph(
        "Computed by <font name='Courier' size=9>ingest/flood_risk/synthetic_flood_risk.py</font> "
        "for all 37 Nigerian states. Blends a fixed flood exposure weight with seasonal variation "
        "and live gauge readings:", S["body"]))
    story.append(Spacer(1, 4))
    story.append(info_box(
        "<font name='Courier' size=9>"
        "score = (base_exposure × seasonal_factor × 0.55)\n"
        "      + (base_exposure × 0.15)\n"
        "      + (live_gauge_modifier × 0.30)"
        "</font>", S["code"], C_GRAY_LT, C_AMBER))
    story.append(Spacer(1, 6))

    synth_rows = [
        ("base_exposure",       "Fixed vulnerability weight per state (0.35–0.90), calibrated against proximity to Niger / Benue / Sokoto / Kaduna rivers"),
        ("seasonal_factor",     "Sinusoidal: 0.15 (dry season Jan–Mar) → 1.0 (peak wet Aug). River-border states get ×1.12 proximity boost."),
        ("live_gauge_modifier", "avg(level_pct_bank × 0.7 + rain_24h/100 × 0.3) across all 26 gauge stations"),
    ]
    story.append(make_table(["Parameter", "Description"], synth_rows, S,
                            col_widths=[42*mm, CONTENT_W - 42*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("GEE Flood Susceptibility Composite Layer (Monthly)", S["h2"]))
    gee_rows = [
        ("JRC Global Surface Water",       "40%", "Historical surface water occurrence", "JRC/GSW1_4/GlobalSurfaceWater"),
        ("HAND (inverse)",                 "30%", "Lower height above drainage = higher susceptibility (max 30 m)", "SRTM elevation − 1 km focal minimum"),
        ("Distance to drainage (inverse)", "20%", "Nearer to water/valley floors = higher susceptibility (max 5 km)", "JRC ≥ 5% or HAND ≤ 3 m drainage mask"),
        ("SRTM Slope (inverse)",           "10%", "Flatter terrain = higher susceptibility", "Derived from SRTM DEM"),
    ]
    story.append(make_table(["Component", "Weight", "Rationale", "GEE Dataset"], gee_rows, S,
                            col_widths=[44*mm, 16*mm, 56*mm, CONTENT_W - 116*mm]))
    story.append(Paragraph(
        "Output: Cloud Optimised GeoTIFF at 1 km resolution (~9.8 MB), uploaded to MinIO "
        "<font name='Courier' size=9>flood-risk-tiles</font> bucket. Tile URL registered in "
        "<font name='Courier' size=9>flood_risk_tiles</font> and served through the API proxy.", S["body_sm"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Sentinel-1 SAR Flood Detection (On Demand / Monthly)", S["h2"]))
    sar_rows = [
        ("Sensor",         "Sentinel-1 GRD IW, VV polarisation, descending orbit"),
        ("Method",         "Change detection: pixel flooded when VV_current < baseline_mean − 1.5 × baseline_std"),
        ("Baseline",       "2-year Sentinel-1 median composite, dry-season months only"),
        ("Masks applied",  "Slope < 5° (SRTM), permanent water < 80% occurrence (JRC)"),
        ("State summaries","30 km buffer reduceRegion → flood fraction per state → saved to flood_risk_areas"),
        ("Download method","3×2 tiled grid to bypass GEE ~32 MB getDownloadURL limit; tiles mosaicked with rasterio → COG → MinIO"),
        ("Best season",    "August–October (wet season). March run confirmed 0 flooded states (dry season, expected)"),
    ]
    story.append(make_table(["Parameter", "Detail"], sar_rows, S,
                            col_widths=[36*mm, CONTENT_W - 36*mm]))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Tile Proxy", S["h3"]))
    story.append(info_box(
        "All COG layers are proxied through FastAPI — no Docker-internal hostnames are "
        "exposed to the browser:<br/><br/>"
        "<font name='Courier' size=9>GET /flood-risk/tiles/{z}/{x}/{y}.png?url=&lt;encoded-cog-url&gt;</font>",
        S["body"], C_GRAY_LT, C_BLUE))

    # ── 7. API REFERENCE ──────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("7.  API Reference", S["h1"]))
    story.append(section_rule())
    story.append(Paragraph(
        "<b>Base URL:</b> <font name='Courier' size=9>http://localhost:8000</font>  "
        "&nbsp;&nbsp; <b>Swagger UI:</b> <font name='Courier' size=9>http://localhost:8000/docs</font>  "
        "&nbsp;&nbsp; <b>Auth:</b> JWT (8-hour token, POST /auth/token)", S["body"]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("REST Endpoints", S["h2"]))
    api_headers = ["Method", "Path", "Description"]
    api_rows = [
        ("GET",  "/health",                          "Liveness check"),
        ("GET",  "/stations",                        "List all 26 gauge stations"),
        ("GET",  "/stations/{id}/readings?hours=24", "Recent gauge readings"),
        ("GET",  "/stations/{id}/features",          "Latest feature snapshot (9 values)"),
        ("GET",  "/stations/{id}/predictions",       "Flood predictions for all 5 horizons"),
        ("GET",  "/stations/{id}/history",           "Hourly aggregated water level history"),
        ("GET",  "/alerts?limit=5",                  "Recent alert log entries"),
        ("GET",  "/rainfall/daily",                  "7-day daily rainfall per met station"),
        ("GET",  "/flood-risk/geojson",              "GeoJSON of all state risk areas"),
        ("GET",  "/flood-risk/layers",               "Available raster tile layers (GEE + SAR)"),
        ("GET",  "/flood-risk/tiles/{z}/{x}/{y}.png","Proxied COG map tiles"),
        ("GET",  "/flood-risk/summary",              "Count of states per risk tier"),
        ("GET",  "/geocode/search?q=Lagos",          "Nominatim geocoding proxy"),
        ("GET",  "/geocode/reverse?lat=&lon=",       "Reverse geocoding"),
        ("POST", "/auth/token",                      "JWT login (returns 8-hour bearer token)"),
    ]
    story.append(make_table(api_headers, api_rows, S,
                            col_widths=[18*mm, 72*mm, CONTENT_W - 90*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("WebSocket Streams", S["h2"]))
    ws_rows = [
        ("/ws/gauge-readings", "30 seconds", "All 26 stations: level_m, flow_m3s, pct_bank"),
        ("/ws/predictions",    "On update",  "Flood probabilities per station per horizon"),
    ]
    story.append(make_table(["Path", "Push Interval", "Payload"], ws_rows, S,
                            col_widths=[52*mm, 32*mm, CONTENT_W - 84*mm]))

    # ── 8. FRONTEND ───────────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("8.  Frontend", S["h1"]))
    story.append(section_rule())
    story.append(Paragraph(
        "Built with React 18, Vite, and Tailwind CSS. MapLibre GL JS for the interactive map. "
        "ECharts for time-series visualisations. Connects to FastAPI via REST and WebSocket.", S["body"]))
    story.append(Spacer(1, 6))

    comp_headers = ["Component", "File", "Purpose"]
    comp_rows = [
        ("App shell",          "App.jsx",               "Layout, header, panel routing"),
        ("Map",                "MapPanel.jsx",           "MapLibre map, risk overlay, GEE/SAR tiles, station markers, dark popups"),
        ("Station list",       "StationList.jsx",        "Left sidebar with per-station bank-level progress bars"),
        ("Prediction panel",   "PredictionPanel.jsx",    "Per-horizon forecast cards with risk tier colour coding"),
        ("Water level chart",  "GaugeChart.jsx",         "24h ECharts line chart with bank-full reference line"),
        ("Rainfall chart",     "RainfallChart.jsx",      "7-day ECharts stacked bar chart per met station"),
        ("Alert banner",       "AlertBanner.jsx",        "Persistent banner for active Watch / Warning / Emergency alerts"),
        ("Search bar",         "SearchBar.jsx",          "Nominatim place search with 300ms debounce"),
        ("Basemap switcher",   "BasemapSwitcher.jsx",    "Dark / Light / Streets / Satellite / Topo (SVG icons, no emoji)"),
        ("Risk layer control", "RiskLayerControl.jsx",   "Toggle + opacity slider + satellite overlay selector"),
        ("Risk legend",        "FloodRiskLegend.jsx",    "Colour-coded tier key"),
        ("Icon library",       "Icons.jsx",              "SVG icon set replacing all emoji (Waves, Search, Gauge, Activity, etc.)"),
    ]
    story.append(make_table(comp_headers, comp_rows, S,
                            col_widths=[36*mm, 44*mm, CONTENT_W - 80*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Basemaps", S["h3"]))
    bm_rows = [
        ("Dark",      "CartoDB Dark Matter",    "Default — optimised for risk overlay visibility"),
        ("Light",     "CartoDB Positron",       "High-contrast labels"),
        ("Streets",   "CartoDB Voyager",        "Road network context"),
        ("Satellite", "Esri World Imagery",     "With label overlay"),
        ("Topo",      "OpenTopoMap",            "Terrain / elevation context"),
    ]
    story.append(make_table(["Name", "Tile Source", "Notes"], bm_rows, S,
                            col_widths=[28*mm, 52*mm, CONTENT_W - 80*mm]))

    story.append(Spacer(1, 6))
    story.append(info_box(
        "<b>Docker HMR on Windows:</b>  Vite is configured with "
        "<font name='Courier' size=9>usePolling: true, interval: 300</font> in "
        "<font name='Courier' size=9>vite.config.js</font>. This is required because "
        "Docker on Windows does not propagate filesystem events into containers. "
        "Without this, code changes do not trigger hot-module replacement.",
        S["body_sm"], C_GRAY_LT, C_AMBER))

    # ── 9. DATA SOURCES ───────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("9.  Data Sources", S["h1"]))
    story.append(section_rule())

    ds_headers = ["Data", "Provider", "Endpoint", "Frequency", "Key?"]
    ds_rows = [
        ("River discharge (GloFAS)",    "OpenMeteo",          "flood-api.open-meteo.com",       "Daily",    "No"),
        ("Rainfall, temp, humidity,\nwind, pressure",
                                        "OpenMeteo",          "api.open-meteo.com",             "Hourly",   "No"),
        ("Flood susceptibility\ncomposite (JRC+HAND+\ndrainage+slope)",
                                        "Google Earth Engine","earthengine.googleapis.com",      "Monthly",  "Service account"),
        ("Sentinel-1 SAR\nflood extent","Google Earth Engine","earthengine.googleapis.com",      "On demand","Service account"),
        ("Geocoding / place search",    "Nominatim (OSM)",    "nominatim.openstreetmap.org",    "On demand","No"),
    ]
    story.append(make_table(ds_headers, ds_rows, S,
                            col_widths=[40*mm, 28*mm, 50*mm, 24*mm, CONTENT_W - 142*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("GEE Service Account", S["h2"]))
    gee_tbl = [
        ("Project",   "nfie-490816"),
        ("Email",     "gee-144@nfie-490816.iam.gserviceaccount.com"),
        ("Key file",  "nfie-490816-516ef004b50f.json  (project root, git-ignored)"),
        ("Rotation",  "GCP Console → IAM → Service Accounts if key expires"),
    ]
    story.append(make_table(["Parameter", "Value"], gee_tbl, S,
                            col_widths=[28*mm, CONTENT_W - 28*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Real vs Synthetic Data", S["h2"]))
    rv_rows = [
        ("River discharge",             "GloFAS via OpenMeteo Flood API",    "Real — satellite-constrained hydrological model"),
        ("Rainfall / met variables",    "OpenMeteo Weather API",              "Real — NWP model with assimilated observations"),
        ("Flood extent (SAR)",          "Sentinel-1 via GEE",                "Real satellite imagery"),
        ("Flood susceptibility",        "JRC GSW + SRTM HAND/drainage via GEE", "Real — historical satellite + terrain hydrology"),
        ("Initial 90-day history",      "backfill.py synthetic generator",   "Synthetic — bootstrap only, not used for production"),
        ("State-level risk polygons",   "synthetic_flood_risk.py",           "Modelled composite (not direct observation)"),
    ]
    story.append(make_table(["Data Type", "Source", "Nature"], rv_rows, S,
                            col_widths=[44*mm, 52*mm, CONTENT_W - 96*mm]))

    # ── 10. SETUP & OPERATIONS ─────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("10.  Setup & Operations", S["h1"]))
    story.append(section_rule())

    story.append(Paragraph("First-Run Sequence", S["h2"]))
    setup_steps = [
        ("1", "Start all services",
         "docker-compose up -d"),
        ("2", "Seed 90-day synthetic history",
         "docker-compose run --rm ingest python backfill.py"),
        ("3", "Expand to 26 gauge + 29 met stations (one-time)",
         "DB_HOST=localhost .venv/Scripts/python ingest/expand_stations.py"),
        ("4", "Backfill feature table for ML training",
         "DB_HOST=localhost .venv/Scripts/python flink/jobs/backfill_features.py"),
        ("5", "Start live feature engineering",
         "DB_HOST=localhost .venv/Scripts/python flink/jobs/flood_features.py --standalone &"),
        ("6", "Train ML models (~10 min)",
         "docker-compose run --rm bentoml python train.py"),
        ("7", "Ingest real data (OpenMeteo + GloFAS)",
         "DB_HOST=localhost .venv/Scripts/python ingest/flood_risk/real_data.py --once"),
        ("8", "Generate state-level risk map",
         "DB_HOST=localhost .venv/Scripts/python ingest/flood_risk/synthetic_flood_risk.py"),
        ("9", "Run GEE JRC+SRTM composite (monthly)",
         "DB_HOST=localhost GEE_SERVICE_ACCOUNT_EMAIL=gee-144@... \\\n"
         "  GEE_SERVICE_ACCOUNT_KEY=./nfie-...json \\\n"
         "  .venv/Scripts/python ingest/flood_risk/gee_flood_risk.py --mode monthly"),
        ("10", "Run Sentinel-1 SAR detection (best Aug–Oct)",
         "DB_HOST=localhost GEE_SERVICE_ACCOUNT_EMAIL=gee-144@... \\\n"
         "  GEE_SERVICE_ACCOUNT_KEY=./nfie-...json \\\n"
         "  .venv/Scripts/python ingest/flood_risk/sentinel1_flood.py"),
        ("11", "Open dashboard",
         "start http://localhost:5173"),
    ]
    for num, desc, cmd in setup_steps:
        block = KeepTogether([
            Table([[
                Paragraph(f"<b>{num}</b>", ParagraphStyle("stepnum",
                          fontName="Helvetica-Bold", fontSize=10, textColor=C_WHITE,
                          alignment=TA_CENTER, leading=12)),
                Paragraph(f"<b>{desc}</b>", S["body"]),
            ]], colWidths=[10*mm, CONTENT_W - 10*mm],
                hAlign="LEFT"),
            Paragraph(f'<font name="Courier" size="8">{cmd}</font>', S["code"]),
            Spacer(1, 4),
        ])
        step_bg = Table([[
            Table([[Paragraph(f"<b>{num}</b>",
                ParagraphStyle("sn2", fontName="Helvetica-Bold", fontSize=9,
                               textColor=C_WHITE, alignment=TA_CENTER, leading=12))]],
                colWidths=[8*mm]),
            Paragraph(f"<b>{desc}</b><br/>"
                      f'<font name="Courier" size="8">{cmd.replace(chr(10),"  ")}</font>',
                      S["body_sm"]),
        ]], colWidths=[14*mm, CONTENT_W - 14*mm])
        step_bg.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), C_BLUE),
            ("BACKGROUND", (1, 0), (1, -1), C_GRAY_LT),
            ("GRID", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(step_bg)
        story.append(Spacer(1, 2))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Common Operational Commands", S["h2"]))
    ops_rows = [
        ("Retrain all models",         "docker-compose run --rm bentoml python train.py"),
        ("Retrain single horizon",     "docker-compose run --rm bentoml python train.py --horizon 24"),
        ("Check running containers",   "docker-compose ps"),
        ("Tail API logs",              "docker-compose logs --tail=50 flood_api"),
        ("Re-run real data ingest",    "DB_HOST=localhost .venv/Scripts/python ingest/flood_risk/real_data.py --once"),
        ("Rebuild frontend image",     "docker-compose up -d --build frontend"),
        ("Stop & remove containers",   "docker-compose down"),
        ("Wipe all data (destructive)","docker-compose down -v"),
    ]
    story.append(make_table(["Action", "Command"], ops_rows, S,
                            col_widths=[52*mm, CONTENT_W - 52*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Service URLs", S["h2"]))
    url_rows = [
        ("Dashboard",        "http://localhost:5173",      "—"),
        ("API + Swagger",    "http://localhost:8000/docs", "—"),
        ("MLflow UI",        "http://localhost:5000",      "—"),
        ("Flink UI",         "http://localhost:8081",      "—"),
        ("MinIO console",    "http://localhost:9001",      "minioadmin / minioadmin"),
        ("Grafana",          "http://localhost:3001",      "admin / admin"),
        ("Prometheus",       "http://localhost:9090",      "—"),
        ("TiTiler",          "http://localhost:8888",      "—"),
    ]
    story.append(make_table(["Service", "URL", "Credentials"], url_rows, S,
                            col_widths=[36*mm, 62*mm, CONTENT_W - 98*mm]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Environment Variables", S["h2"]))
    env_rows = [
        ("POSTGRES_USER",           "flood",                      "TimescaleDB username"),
        ("POSTGRES_PASSWORD",       "floodpass",                  "TimescaleDB password"),
        ("POSTGRES_DB",             "flooddb",                    "Database name"),
        ("MINIO_ROOT_USER",         "minioadmin",                 "MinIO access key"),
        ("MINIO_ROOT_PASSWORD",     "minioadmin",                 "MinIO secret key"),
        ("JWT_SECRET",              "dev-secret-change-in-prod",  "API JWT signing key"),
        ("GEE_SERVICE_ACCOUNT_EMAIL","—",                         "GEE service account email"),
        ("GEE_SERVICE_ACCOUNT_KEY", "—",                          "Path to GEE JSON key file"),
        ("AUC_GATE",                "0.80",                       "Min AUC-ROC for model registration"),
        ("F1_GATE",                 "0.60",                       "Min F1 for model registration"),
    ]
    story.append(make_table(["Variable", "Default", "Description"], env_rows, S,
                            col_widths=[52*mm, 52*mm, CONTENT_W - 104*mm]))

    # ── 11. LIMITATIONS & ROADMAP ─────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("11.  Known Limitations & Roadmap", S["h1"]))
    story.append(section_rule())

    story.append(Paragraph("Current Limitations", S["h2"]))
    limits = [
        ("LSTM short-horizon models not registered",
         "The 6h, 12h, 24h LSTM models did not meet the F1 quality gate. The training "
         "dataset still contains a large synthetic fraction. XGBoost alone is used for "
         "those horizons (AUC > 0.92 — fully acceptable). LSTM performance will improve "
         "as real GloFAS data accumulates over 6+ months.",
         C_AMBER),
        ("State polygons are bounding boxes",
         "flood_risk_areas geometries are rectangular state approximations. Replace with "
         "official GADM Nigeria Level 1 boundaries (free, CC-BY from gadm.org) for "
         "production. High visual impact, ~2 hours effort.",
         C_AMBER),
        ("Rainfall not distance-weighted",
         "rolling_rain_Xh_mm aggregates all 29 met stations equally regardless of distance "
         "to the gauge. A production system should use inverse-distance weighting. "
         "~3 hours to implement in flink/jobs/flood_features.py.",
         HexColor("#94a3b8")),
        ("No in-situ sensor data",
         "All gauge and met data comes from GloFAS and OpenMeteo model output — no physical "
         "sensors are connected. NIHSA (Nigeria Hydrological Services Agency) operates real "
         "gauges; a data-sharing agreement would dramatically improve accuracy.",
         HexColor("#94a3b8")),
        ("SAR shows 0 flooded states (dry season)",
         "Sentinel-1 correctly detected no active flooding in March 2026 (dry season). "
         "Re-run sentinel1_flood.py in August–October to capture peak wet-season flood extent. "
         "Schedule monthly via APScheduler or cron.",
         HexColor("#94a3b8")),
        ("Manning discharge→level is a rough proxy",
         "h = (Q/k)^(1/1.67) with k=35 is calibrated roughly for Nigerian rivers. "
         "Station-specific rating curves from NIHSA would improve water-level accuracy.",
         HexColor("#94a3b8")),
    ]
    for title, desc, col in limits:
        t = Table([[
            Paragraph(f"<b>{title}</b>", S["body"]),
            Paragraph(desc, S["body_sm"]),
        ]], colWidths=[52*mm, CONTENT_W - 52*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), C_GRAY_LT),
            ("BOX", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LINEBEFORE", (0, 0), (0, -1), 3, col),
        ]))
        story.append(t)
        story.append(Spacer(1, 3))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Recommended Next Steps", S["h2"]))
    roadmap = [
        ("Priority 1", "Replace synthetic state polygons with GADM Nigeria boundaries",
         "~2 h", C_RED),
        ("Priority 2", "Schedule Sentinel-1 monthly re-run (Aug–Oct wet season)",
         "~1 h", C_AMBER),
        ("Priority 3", "Implement distance-weighted rainfall feature in flood_features.py",
         "~3 h", C_AMBER),
        ("Priority 4", "Accumulate real data and retrain quarterly",
         "Ongoing", C_GREEN),
        ("Priority 5", "NIHSA real gauge sensor integration",
         "Weeks", C_GREEN),
        ("Priority 6", "Production deployment to GCP (Cloud SQL / Cloud Run / Firebase)",
         "1–2 weeks", HexColor("#8b5cf6")),
    ]
    rm_data = [[Paragraph("Priority", S["th"]),
                Paragraph("Task", S["th"]),
                Paragraph("Effort", S["th"])]]
    for pri, task, effort, col in roadmap:
        rm_data.append([
            Paragraph(pri, ParagraphStyle("rp", fontName="Helvetica-Bold",
                       fontSize=8.5, textColor=col, leading=11)),
            Paragraph(task, S["td"]),
            Paragraph(effort, S["td"]),
        ])
    rm_t = Table(rm_data, colWidths=[26*mm, CONTENT_W - 48*mm, 22*mm])
    rm_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), C_HEADER_BG),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_GRAY_LT]),
        ("GRID", (0, 0), (-1, -1), 0.4, C_GRAY_MID),
        ("LINEBELOW", (0, 0), (-1, 0), 1, C_BLUE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(rm_t)

    story.append(Spacer(1, 10))
    story.append(Paragraph("Production Migration Path (GCP)", S["h2"]))
    prod_rows = [
        ("TimescaleDB",    "Cloud SQL (PostgreSQL) or AlloyDB"),
        ("MinIO",          "Google Cloud Storage"),
        ("Apache Flink",   "Dataflow (Apache Beam)"),
        ("MLflow",         "Vertex AI Experiments"),
        ("BentoML",        "Vertex AI Prediction or Cloud Run"),
        ("FastAPI",        "Cloud Run"),
        ("React frontend", "Firebase Hosting with Cloud CDN"),
        ("APScheduler",    "Cloud Scheduler + Cloud Functions"),
    ]
    story.append(make_table(["Local Component", "GCP Equivalent"], prod_rows, S,
                            col_widths=[52*mm, CONTENT_W - 52*mm]))

    # ── BUILD ────────────────────────────────────────────────────────────────
    doc.build(
        story,
        onFirstPage=draw_cover,
        onLaterPages=on_page,
    )
    print(f"PDF generated: {OUTPUT}")


if __name__ == "__main__":
    build()
