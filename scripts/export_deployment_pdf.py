from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "DEPLOYMENT_AWS_GFW.md"
TARGET = ROOT / "DEPLOYMENT_AWS_GFW.pdf"


def styles():
    sample = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleCustom",
            parent=sample["Title"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            spaceAfter=10,
            textColor=colors.HexColor("#0f172a"),
            alignment=TA_LEFT,
        ),
        "h2": ParagraphStyle(
            "Heading2Custom",
            parent=sample["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            spaceBefore=8,
            spaceAfter=6,
            textColor=colors.HexColor("#0369a1"),
        ),
        "body": ParagraphStyle(
            "BodyCustom",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            spaceAfter=5,
            textColor=colors.black,
        ),
        "mono": ParagraphStyle(
            "MonoCustom",
            parent=sample["Code"],
            fontName="Courier",
            fontSize=8.5,
            leading=11,
            leftIndent=8,
            borderPadding=6,
            backColor=colors.HexColor("#f8fafc"),
            borderColor=colors.HexColor("#cbd5e1"),
            borderWidth=0.5,
            borderRadius=2,
            spaceBefore=3,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "BulletCustom",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            leftIndent=0,
            firstLineIndent=0,
            spaceAfter=1,
        ),
    }


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def flush_bullets(story, bullet_lines, st):
    if not bullet_lines:
        return
    items = [ListItem(Paragraph(esc(line), st["bullet"])) for line in bullet_lines]
    story.append(
        ListFlowable(
            items,
            bulletType="bullet",
            start="circle",
            leftIndent=14,
        )
    )
    story.append(Spacer(1, 2))
    bullet_lines.clear()


def flush_table(story, table_lines, st):
    if not table_lines:
        return
    for raw in table_lines:
        if raw.strip().startswith("|---"):
            continue
        cols = [c.strip() for c in raw.strip().strip("|").split("|")]
        if cols:
            line = " | ".join(cols)
            story.append(Paragraph(esc(line), st["mono"]))
    table_lines.clear()


def build():
    st = styles()
    story = []
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    bullet_lines = []
    table_lines = []
    in_code = False
    code_lines = []

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_bullets(story, bullet_lines, st)
            flush_table(story, table_lines, st)
            if in_code:
                story.append(Paragraph(esc("\n".join(code_lines)), st["mono"]))
                code_lines = []
                in_code = False
            else:
                in_code = True
            continue

        if in_code:
            code_lines.append(line)
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            flush_bullets(story, bullet_lines, st)
            table_lines.append(line)
            continue
        else:
            flush_table(story, table_lines, st)

        if not stripped:
            flush_bullets(story, bullet_lines, st)
            story.append(Spacer(1, 4))
            continue

        if stripped.startswith("# "):
            flush_bullets(story, bullet_lines, st)
            story.append(Paragraph(esc(stripped[2:].strip()), st["title"]))
            continue

        if stripped.startswith("## "):
            flush_bullets(story, bullet_lines, st)
            story.append(Paragraph(esc(stripped[3:].strip()), st["h2"]))
            continue

        if stripped.startswith("- "):
            bullet_lines.append(stripped[2:].strip())
            continue

        if stripped[0:2].isdigit() and stripped[1:2] == ".":
            flush_bullets(story, bullet_lines, st)
            story.append(Paragraph(esc(stripped), st["body"]))
            continue

        story.append(Paragraph(esc(stripped), st["body"]))

    flush_bullets(story, bullet_lines, st)
    flush_table(story, table_lines, st)
    if code_lines:
        story.append(Paragraph(esc("\n".join(code_lines)), st["mono"]))

    doc = SimpleDocTemplate(
        str(TARGET),
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="GGIS Flood Watch Deployment Guide",
        author="Cursor",
    )
    doc.build(story)
    print(TARGET)


if __name__ == "__main__":
    build()
