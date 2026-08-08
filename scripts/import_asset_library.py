#!/usr/bin/env python3
"""
Import a CURATED subset of the local Website_1/Asset_Library into SparqMake's
LOCAL dev stack (local Postgres + local uploads dir).

LOCAL STAGING ONLY. Idempotent (safe to re-run). Does NOT commit anything.

IMPORTANT served-path note (verified, not assumed):
  The api-server does NOT use a generic express.static mount for /api/files.
  It registers explicit per-segment routes in src/routes/upload.ts and
  serveFile() REJECTS any filename containing "/". A dedicated route now
  serves the curated library:
      /api/files/assets/:filename  ->  uploads/assets/
  This subdir is OWNED by this importer and is intentionally separate from
  uploads/brand-assets/ (app-uploaded brand logos), so the idempotent reset
  below can never delete real brand logos.
"""

import os
import re
import shutil
import subprocess
import sys
import csv

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SOURCE_ROOT = "/Users/tonydye/Sparq 26/Website_1/Asset_Library"
API_SERVER_DIR = "/Users/tonydye/Sparq 26/SparqMake/artifacts/api-server"
# Served subdir (verified above). Files here are served at /api/files/assets/<f>.
DEST_SUBDIR = "assets"
DEST_DIR = os.path.join(API_SERVER_DIR, "uploads", DEST_SUBDIR)
URL_PREFIX = f"/api/files/{DEST_SUBDIR}"

MANIFEST_PATH = "/tmp/asset-import-manifest.csv"

UPLOADED_BY = "asset-import"
MIN_LARGER_DIM = 640  # skip if larger dimension < 640px

PSQL = [
    "docker", "exec", "-i", "sparqmake-pg",
    "psql", "-U", "postgres", "-d", "sparqmake", "-v", "ON_ERROR_STOP=1",
]

IMAGE_EXTS = {".png", ".jpg", ".jpeg"}


# ---------------------------------------------------------------------------
# psql helpers
# ---------------------------------------------------------------------------
def psql_run(sql, capture=True):
    """Run SQL through docker psql. Returns stdout (str) when capture=True."""
    proc = subprocess.run(
        PSQL,
        input=sql,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write("SQL ERROR:\n" + proc.stderr + "\n")
        sys.stderr.write("SQL was:\n" + sql[:4000] + "\n")
        raise SystemExit(1)
    return proc.stdout if capture else None


def psql_query_rows(sql):
    """Run a query with -tA (tuples only, unaligned) and return list of field-lists."""
    proc = subprocess.run(
        PSQL + ["-tA", "-F", "\t"],
        input=sql,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write("SQL ERROR:\n" + proc.stderr + "\n")
        raise SystemExit(1)
    rows = []
    for line in proc.stdout.splitlines():
        if line == "":
            continue
        rows.append(line.split("\t"))
    return rows


def sql_str(s):
    """Single-quote-escape a Python string for SQL."""
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def sql_text_array(items):
    """Build a Postgres text[] literal: ARRAY['a','b']."""
    if not items:
        return "ARRAY[]::text[]"
    return "ARRAY[" + ", ".join(sql_str(x) for x in items) + "]::text[]"


# ---------------------------------------------------------------------------
# Curation: decide whether to include a file and how to classify it.
# rel_path is POSIX-style path relative to SOURCE_ROOT.
# ---------------------------------------------------------------------------
EXCLUDED_TOP_FOLDERS = {
    "product-ui", "mockups-screenshots", "team", "misc",
}


def classify(rel_path):
    """
    Return a dict with brand_slug, asset_class, type for an included file,
    or a string reason code for a skip:
      'skip_excluded_folder', 'skip_texture', 'skip_non_image'
    (low-res skip is handled separately after measuring dims).
    """
    parts = rel_path.split("/")
    top = parts[0]
    basename = parts[-1]
    name_lower = basename.lower()
    _, ext = os.path.splitext(name_lower)

    # Non-image
    if ext not in IMAGE_EXTS:
        return "skip_non_image"

    # Excluded folders
    if top in EXCLUDED_TOP_FOLDERS:
        return "skip_excluded_folder"

    # renders: skip ref_texture_* PBR maps
    if top == "renders":
        if name_lower.startswith("ref_texture_"):
            return "skip_texture"
        return {"brand_slug": "crown-u", "asset_class": "style_reference", "type": "render"}

    if top == "characters":
        # sparq-branded / university / _unclassified  (all crown-u)
        return {"brand_slug": "crown-u", "asset_class": "subject_reference", "type": "character"}

    if top in ("style-references", "style-inspiration"):
        return {"brand_slug": "crown-u", "asset_class": "style_reference", "type": "style_reference"}

    if top == "backgrounds":
        return {"brand_slug": "crown-u", "asset_class": "style_reference", "type": "background"}

    if top == "logos":
        sub = parts[1] if len(parts) > 1 else ""
        if sub == "crownu":
            return {"brand_slug": "crown-u", "asset_class": "compositing", "type": "logo"}
        if sub == "sparq":
            return {"brand_slug": "corporate", "asset_class": "compositing", "type": "logo"}
        if sub == "game-brands":
            if "rumble" in name_lower:
                slug = "rumble-u"
            elif "mascot" in name_lower:
                slug = "mascot-mayhem"
            elif "crown" in name_lower:
                slug = "crown-u"
            else:
                slug = "corporate"
            return {"brand_slug": slug, "asset_class": "compositing", "type": "logo"}
        if sub in ("university", "partner"):
            return {"brand_slug": "crown-u", "asset_class": "context", "type": "logo"}
        # Unknown logo subfolder -> treat as excluded (defensive)
        return "skip_excluded_folder"

    if top == "brand-reference":
        return {"brand_slug": "corporate", "asset_class": "context", "type": "brand_reference"}

    if top == "marketing":
        return {"brand_slug": "corporate", "asset_class": "context", "type": "marketing"}

    if top == "investor-materials":
        # includes trailer-assets subfolder
        return {"brand_slug": "corporate", "asset_class": "context", "type": "context"}

    # Any other top folder -> excluded
    return "skip_excluded_folder"


# ---------------------------------------------------------------------------
# Name + filename helpers
# ---------------------------------------------------------------------------
STRIP_PREFIXES = [
    "ref_render_", "ref_concept_", "style_reference_", "style_background_",
    "crown-u_", "crownu_", "ref_deck-slide_", "ref_storyboard_", "ref_trailer_",
    "style_inspiration_", "ref_", "style_", "asset_",
]


def human_name(basename):
    """Drop extension, strip known prefixes, normalize separators, Title Case."""
    stem, _ = os.path.splitext(basename)
    low = stem.lower()
    changed = True
    # Repeatedly strip leading known prefixes (e.g. "ref_render_" then nothing).
    while changed:
        changed = False
        for p in STRIP_PREFIXES:
            if low.startswith(p):
                low = low[len(p):]
                changed = True
                break
    # Replace separators with spaces, collapse.
    low = re.sub(r"[_\-]+", " ", low)
    low = re.sub(r"\s+", " ", low).strip()
    if not low:
        # Fell through to empty (e.g. name was entirely a prefix) -> use stem.
        low = re.sub(r"[_\-]+", " ", stem).strip()
    # Title Case but keep tokens reasonable.
    name = low.title()
    # Keep it concise: cap at ~80 chars.
    if len(name) > 80:
        name = name[:80].rstrip()
    return name


def sanitize_dest(top_folder, basename):
    """DEST filename = sanitized <topFolder>__<originalBasename> (lowercase, spaces->-)."""
    stem, ext = os.path.splitext(basename)
    raw = f"{top_folder}__{stem}{ext}"
    raw = raw.lower()
    # spaces -> -, and any char not [a-z0-9._-] -> -
    raw = raw.replace(" ", "-")
    raw = re.sub(r"[^a-z0-9._-]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw)
    return raw


def mime_for(basename):
    _, ext = os.path.splitext(basename.lower())
    if ext == ".png":
        return "image/png"
    return "image/jpeg"  # .jpg / .jpeg


def measure_larger_dim(path):
    """Return larger of pixelWidth/pixelHeight using sips, or None if unreadable."""
    try:
        out = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
            capture_output=True, text=True,
        )
        if out.returncode != 0:
            return None
        w = h = None
        for line in out.stdout.splitlines():
            line = line.strip()
            if line.startswith("pixelWidth:"):
                w = int(line.split(":", 1)[1].strip())
            elif line.startswith("pixelHeight:"):
                h = int(line.split(":", 1)[1].strip())
        if w is None or h is None:
            return None
        return max(w, h)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    if not os.path.isdir(SOURCE_ROOT):
        sys.stderr.write(f"SOURCE_ROOT does not exist: {SOURCE_ROOT}\n")
        raise SystemExit(1)

    # 1) Resolve brand ids.
    # Game-brand slugs are stable in every environment. The Sparq brand is
    # NOT: the deploy was hand-edited to name 'Sparq'/slug 'sparq' while the
    # local seed used 'Corporate'/'corporate' (migration 0006 reconciles both
    # to 'Sparq'/'sparq'). So resolve it by NAME first with slug fallback,
    # never a single hardcoded slug. The internal key stays 'corporate'
    # (what classify() returns); it maps to whichever row is the Sparq brand.
    required = ["crown-u", "rumble-u", "mascot-mayhem"]
    rows = psql_query_rows("SELECT slug, id FROM brands ORDER BY slug;")
    brand_id = {r[0]: r[1] for r in rows}
    missing = [s for s in required if s not in brand_id]
    if missing:
        sys.stderr.write(f"Missing brand slugs, stopping: {missing}\n")
        raise SystemExit(1)
    sparq = psql_query_rows(
        "SELECT id FROM brands "
        "WHERE name IN ('Sparq', 'Corporate') OR slug IN ('sparq', 'corporate');"
    )
    if len(sparq) != 1:
        sys.stderr.write(
            f"Expected exactly 1 Sparq brand row, found {len(sparq)}: stopping.\n"
        )
        raise SystemExit(1)
    brand_id["corporate"] = sparq[0][0]
    print(f"Brands OK: {brand_id}")

    # 2) Idempotency: clear prior import rows + empty dest dir.
    psql_run(f"DELETE FROM assets WHERE uploaded_by = {sql_str(UPLOADED_BY)};", capture=False)
    os.makedirs(DEST_DIR, exist_ok=True)
    for f in os.listdir(DEST_DIR):
        fp = os.path.join(DEST_DIR, f)
        if os.path.isfile(fp):
            os.remove(fp)
    print(f"Cleared prior '{UPLOADED_BY}' rows and emptied {DEST_DIR}")

    # 3) Walk source, classify, measure, copy, accumulate rows.
    scanned = 0
    skip_non_image = 0
    skip_excluded = 0
    skip_texture = 0
    skip_lowres = 0
    skip_unreadable = 0

    imported = []           # dicts of row data + manifest data
    dest_names_used = {}     # dest filename -> source rel_path (collision guard)
    total_bytes = 0

    for dirpath, dirnames, filenames in os.walk(SOURCE_ROOT):
        # Prune excluded top-level folders early for speed.
        rel_dir = os.path.relpath(dirpath, SOURCE_ROOT)
        if rel_dir == ".":
            # filter top-level dirs in place
            dirnames[:] = [d for d in dirnames if d not in EXCLUDED_TOP_FOLDERS]
        for fn in filenames:
            if fn == ".DS_Store":
                continue
            scanned += 1
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, SOURCE_ROOT).replace(os.sep, "/")
            verdict = classify(rel)
            if isinstance(verdict, str):
                if verdict == "skip_non_image":
                    skip_non_image += 1
                elif verdict == "skip_texture":
                    skip_texture += 1
                else:
                    skip_excluded += 1
                continue

            # Low-res skip (measure dims).
            larger = measure_larger_dim(full)
            if larger is None:
                skip_unreadable += 1
                continue
            if larger < MIN_LARGER_DIM:
                skip_lowres += 1
                continue

            parts = rel.split("/")
            top = parts[0]
            subfolders = parts[1:-1]  # between top and filename
            basename = parts[-1]

            dest_file = sanitize_dest(top, basename)
            # Collision guard (shouldn't happen given top__basename, but be safe).
            if dest_file in dest_names_used:
                stem, ext = os.path.splitext(dest_file)
                i = 2
                while f"{stem}-{i}{ext}" in dest_names_used:
                    i += 1
                dest_file = f"{stem}-{i}{ext}"
            dest_names_used[dest_file] = rel

            # Copy file.
            dest_path = os.path.join(DEST_DIR, dest_file)
            shutil.copy2(full, dest_path)
            size = os.path.getsize(dest_path)
            total_bytes += size

            rel_folder = "/".join(parts[:-1])  # folder path under SOURCE_ROOT
            asset_class = verdict["asset_class"]
            is_compositing = (asset_class == "compositing")

            tags = ["imported", top]
            for sf in subfolders:
                if sf and sf not in tags:
                    tags.append(sf)

            imported.append({
                "brand_slug": verdict["brand_slug"],
                "asset_class": asset_class,
                # The app's Asset Library "Visual Assets" tab filters on type='visual';
                # the folder-derived kind (render/character/logo/...) goes in sub_type.
                "type": "visual",
                "sub_type": verdict["type"],
                "name": human_name(basename),
                "description": f"Imported from Website_1/Asset_Library/{rel_folder}",
                "tags": tags,
                "file_url": f"{URL_PREFIX}/{dest_file}",
                "mime_type": mime_for(basename),
                "file_size_bytes": size,
                "is_compositing": is_compositing,
                "source_relpath": rel,
                "dest_file": dest_file,
            })

    print(f"Scanned={scanned} Imported={len(imported)} "
          f"skip(lowres={skip_lowres}, texture={skip_texture}, "
          f"excluded={skip_excluded}, non_image={skip_non_image}, "
          f"unreadable={skip_unreadable})")

    if not imported:
        sys.stderr.write("Nothing to import; aborting before SQL.\n")
        raise SystemExit(1)

    # 4) Build one transactional SQL batch of INSERTs.
    lines = ["BEGIN;"]
    for r in imported:
        sql = (
            "INSERT INTO assets ("
            "id, brand_id, type, sub_type, status, name, description, tags, file_url, "
            "thumbnail_url, mime_type, file_size_bytes, uploaded_by, approved_by, "
            "approved_at, asset_class, generation_role, compositing_only, "
            "generation_allowed, approved_for_compositing, character_identity_note"
            ") VALUES ("
            "gen_random_uuid(), "
            f"{sql_str(brand_id[r['brand_slug']])}, "  # resolved id (see step 1)
            f"{sql_str(r['type'])}, "
            f"{sql_str(r['sub_type'])}, "
            "'approved', "
            f"{sql_str(r['name'])}, "
            f"{sql_str(r['description'])}, "
            f"{sql_text_array(r['tags'])}, "
            f"{sql_str(r['file_url'])}, "
            f"{sql_str(r['file_url'])}, "  # thumbnail_url = file_url
            f"{sql_str(r['mime_type'])}, "
            f"{r['file_size_bytes']}, "
            f"{sql_str(UPLOADED_BY)}, "
            f"{sql_str(UPLOADED_BY)}, "    # approved_by
            "now(), "
            f"{sql_str(r['asset_class'])}, "
            f"{sql_str(r['asset_class'])}, "  # generation_role = asset_class
            f"{'true' if r['is_compositing'] else 'false'}, "  # compositing_only
            "true, "                          # generation_allowed
            f"{'true' if r['is_compositing'] else 'false'}, "  # approved_for_compositing
            "''"                              # character_identity_note (NOT NULL)
            ");"
        )
        lines.append(sql)
    lines.append("COMMIT;")
    psql_run("\n".join(lines), capture=False)
    print(f"Inserted {len(imported)} rows.")

    # 5) Write manifest CSV.
    with open(MANIFEST_PATH, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["brand_slug", "asset_class", "type", "name",
                    "source_relpath", "dest_file", "size_kb"])
        for r in sorted(imported, key=lambda x: (x["brand_slug"], x["asset_class"], x["source_relpath"])):
            w.writerow([
                r["brand_slug"], r["asset_class"], r["type"], r["name"],
                r["source_relpath"], r["dest_file"],
                f"{r['file_size_bytes']/1024:.1f}",
            ])
    print(f"Manifest written: {MANIFEST_PATH}")

    # 6) Verify.
    print("\n=== Per brand/class counts (DB) ===")
    print(psql_run(
        "SELECT b.slug, a.asset_class, count(*) "
        "FROM assets a JOIN brands b ON a.brand_id=b.id "
        f"WHERE a.uploaded_by={sql_str(UPLOADED_BY)} "
        "GROUP BY 1,2 ORDER BY 1,2;"
    ))

    grand = psql_query_rows(
        f"SELECT count(*) FROM assets WHERE uploaded_by={sql_str(UPLOADED_BY)};"
    )[0][0]
    files_on_disk = len([f for f in os.listdir(DEST_DIR)
                         if os.path.isfile(os.path.join(DEST_DIR, f))])
    print(f"DB grand total rows: {grand}")
    print(f"Files in {DEST_DIR}: {files_on_disk}")
    print(f"Row count == file count? {'YES' if int(grand) == files_on_disk else 'NO -- MISMATCH'}")
    print(f"Total bytes copied: {total_bytes} ({total_bytes/1024/1024:.2f} MiB)")

    print("\n=== 10 sample rows ===")
    print(psql_run(
        "SELECT a.name, a.type, a.asset_class, b.slug, a.file_url "
        "FROM assets a JOIN brands b ON a.brand_id=b.id "
        f"WHERE a.uploaded_by={sql_str(UPLOADED_BY)} "
        "ORDER BY random() LIMIT 10;"
    ))

    # Emit a machine-readable summary line for the report.
    print("SUMMARY_JSON=" + str({
        "scanned": scanned,
        "imported": len(imported),
        "skipped_total": scanned - len(imported),
        "skip_lowres": skip_lowres,
        "skip_texture": skip_texture,
        "skip_excluded_folder": skip_excluded,
        "skip_non_image": skip_non_image,
        "skip_unreadable": skip_unreadable,
        "db_rows": int(grand),
        "files_on_disk": files_on_disk,
        "total_bytes": total_bytes,
        "dest_dir": DEST_DIR,
        "url_prefix": URL_PREFIX,
    }))


if __name__ == "__main__":
    main()
