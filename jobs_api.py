"""
Suisse Carrière — API Postes (à ajouter au backend Render)
===========================================================
Endpoints :
  GET  /jobs      → Liste des postes actifs (JSON)
  POST /jobs/sync → Reçoit les postes du scraper (auth requise)
  POST /interest  → Enregistre un intérêt candidat

Ajouter ces routes à votre app Flask existante sur Render.
"""

import json
import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import Blueprint, jsonify, request

# ═══════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════
JOBS_DB = os.environ.get("JOBS_DB_PATH", "jobs_board.db")
SYNC_SECRET = os.environ.get("SYNC_SECRET", "changez-moi-en-production")

jobs_bp = Blueprint("jobs", __name__)


# ═══════════════════════════════════════
# DATABASE
# ═══════════════════════════════════════
def get_db():
    conn = sqlite3.connect(JOBS_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            hospital TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT DEFAULT '',
            department TEXT DEFAULT '',
            date_posted TEXT DEFAULT '',
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            canton TEXT DEFAULT '',
            type TEXT DEFAULT '',
            metier TEXT DEFAULT '',
            active INTEGER DEFAULT 1
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS interests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_title TEXT,
            job_hospital TEXT,
            candidate_metier TEXT,
            candidate_experience TEXT,
            candidate_zone TEXT,
            candidate_statut TEXT,
            candidate_crs TEXT,
            candidate_email TEXT DEFAULT '',
            timestamp TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def require_sync_auth(f):
    """Simple auth pour le sync scraper → API."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("X-Sync-Token", "")
        if token != SYNC_SECRET:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


# ═══════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════

@jobs_bp.route("/jobs", methods=["GET"])
def list_jobs():
    """
    GET /jobs
    Returns all active jobs from the last 30 days.
    Optional query params: canton, metier, type
    """
    conn = get_db()
    cutoff = (datetime.now() - timedelta(days=30)).isoformat()

    query = "SELECT * FROM jobs WHERE active = 1 AND last_seen > ? ORDER BY first_seen DESC"
    rows = conn.execute(query, (cutoff,)).fetchall()
    conn.close()

    jobs = []
    for row in rows:
        jobs.append({
            "id": row["id"],
            "hospital": row["hospital"],
            "title": row["title"],
            "url": row["url"],
            "department": row["department"],
            "date_posted": row["date_posted"],
            "first_seen": row["first_seen"],
            "last_seen": row["last_seen"],
            "canton": row["canton"],
            "type": row["type"],
            "metier": row["metier"],
        })

    return jsonify({
        "jobs": jobs,
        "count": len(jobs),
        "updated": datetime.now().strftime("%d/%m/%Y %H:%M"),
    })


@jobs_bp.route("/jobs/sync", methods=["POST"])
@require_sync_auth
def sync_jobs():
    """
    POST /jobs/sync
    Body: { "jobs": [ { hospital, title, url, department, date_posted, first_seen, last_seen, id } ] }
    Header: X-Sync-Token: <SYNC_SECRET>

    Called by the scraper after each run.
    """
    data = request.get_json()
    if not data or "jobs" not in data:
        return jsonify({"error": "Missing 'jobs' array"}), 400

    conn = get_db()
    now = datetime.now().isoformat()
    synced = 0
    new = 0

    # Mark all jobs as potentially inactive
    conn.execute("UPDATE jobs SET active = 0")

    for job in data["jobs"]:
        job_id = job.get("id", "")
        if not job_id:
            continue

        existing = conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()

        if existing:
            conn.execute("""
                UPDATE jobs SET
                    last_seen = ?, active = 1,
                    hospital = ?, title = ?, url = ?,
                    department = ?, date_posted = ?,
                    canton = ?, type = ?, metier = ?
                WHERE id = ?
            """, (
                now, job.get("hospital", ""), job.get("title", ""),
                job.get("url", ""), job.get("department", ""),
                job.get("date_posted", ""), job.get("canton", ""),
                job.get("type", ""), job.get("metier", ""), job_id
            ))
        else:
            conn.execute("""
                INSERT INTO jobs (id, hospital, title, url, department, date_posted,
                                  first_seen, last_seen, canton, type, metier, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (
                job_id, job.get("hospital", ""), job.get("title", ""),
                job.get("url", ""), job.get("department", ""),
                job.get("date_posted", ""), job.get("first_seen", now),
                now, job.get("canton", ""), job.get("type", ""),
                job.get("metier", "")
            ))
            new += 1

        synced += 1

    # Re-activate jobs seen in last 3 days even if not in this sync
    three_days_ago = (datetime.now() - timedelta(days=3)).isoformat()
    conn.execute("UPDATE jobs SET active = 1 WHERE last_seen > ? AND active = 0", (three_days_ago,))

    conn.commit()
    conn.close()

    return jsonify({"synced": synced, "new": new, "timestamp": now})


@jobs_bp.route("/interest", methods=["POST"])
def express_interest():
    """
    POST /interest
    Body: { job_title, job_hospital, candidate: { metier, experience, zone, statut, crs_status } }

    Records candidate interest in a job. Sends notification to admin.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing body"}), 400

    conn = get_db()
    candidate = data.get("candidate", {})

    conn.execute("""
        INSERT INTO interests (job_title, job_hospital, candidate_metier,
                              candidate_experience, candidate_zone,
                              candidate_statut, candidate_crs,
                              candidate_email, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("job_title", ""),
        data.get("job_hospital", ""),
        candidate.get("metier", ""),
        candidate.get("experience", ""),
        candidate.get("zone", ""),
        candidate.get("statut", ""),
        candidate.get("crs_status", ""),
        data.get("email", ""),
        data.get("timestamp", datetime.now().isoformat()),
    ))
    conn.commit()
    conn.close()

    # TODO: Send email notification to admin
    # send_interest_notification(data)

    return jsonify({"status": "ok", "message": "Intérêt enregistré"})


# ═══════════════════════════════════════
# INTEGRATION
# ═══════════════════════════════════════
# In your main app.py, add:
#
#   from jobs_api import jobs_bp
#   app.register_blueprint(jobs_bp)
#
# Environment variables to set on Render:
#   JOBS_DB_PATH=jobs_board.db
#   SYNC_SECRET=votre-secret-aleatoire
