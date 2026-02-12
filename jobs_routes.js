// ═══════════════════════════════════════════════════════════════
// SUISSE CARRIÈRE — ROUTES API POSTES (Express.js)
// ═══════════════════════════════════════════════════════════════
// GET  /jobs         → Liste des postes (pour le frontend)
// POST /jobs/sync    → Reçoit les postes du scraper Python
// POST /interest     → Enregistre un intérêt candidat
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ─── Fichier JSON simple (pas besoin de SQLite) ───
const JOBS_FILE = path.join(__dirname, 'jobs_data.json');
const INTERESTS_FILE = path.join(__dirname, 'interests_data.json');
const SYNC_SECRET = process.env.SYNC_SECRET || 'changez-moi';

// ─── Helpers ───
function readJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Erreur lecture jobs:', e.message);
  }
  return { jobs: [], updated: null };
}

function writeJobs(data) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function readInterests() {
  try {
    if (fs.existsSync(INTERESTS_FILE)) {
      return JSON.parse(fs.readFileSync(INTERESTS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Erreur lecture interests:', e.message);
  }
  return [];
}

function writeInterests(data) {
  fs.writeFileSync(INTERESTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════
// ROUTE 1 : GET /jobs — Le frontend appelle ça
// ═══════════════════════════════════════════════════════════════
function getJobs(req, res) {
  const data = readJobs();

  // Filtrer les postes de moins de 30 jours
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const activeJobs = (data.jobs || []).filter(j => {
    return (j.last_seen || j.first_seen || '') > cutoff;
  });

  res.json({
    jobs: activeJobs,
    count: activeJobs.length,
    updated: data.updated || new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════════════════════════
// ROUTE 2 : POST /jobs/sync — Le scraper Python appelle ça
// ═══════════════════════════════════════════════════════════════
function syncJobs(req, res) {
  // Vérifier le secret
  const token = req.headers['x-sync-token'] || '';
  if (token !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const incoming = req.body;
  if (!incoming || !incoming.jobs) {
    return res.status(400).json({ error: "Missing 'jobs' array" });
  }

  // Lire les postes existants
  const existing = readJobs();
  const existingMap = {};
  (existing.jobs || []).forEach(j => {
    if (j.id) existingMap[j.id] = j;
  });

  let newCount = 0;
  const now = new Date().toISOString();

  // Merger les postes
  incoming.jobs.forEach(job => {
    if (!job.id) return;
    if (existingMap[job.id]) {
      // Mettre à jour last_seen
      existingMap[job.id].last_seen = now;
      existingMap[job.id].title = job.title || existingMap[job.id].title;
      existingMap[job.id].url = job.url || existingMap[job.id].url;
      existingMap[job.id].department = job.department || existingMap[job.id].department;
      existingMap[job.id].canton = job.canton || existingMap[job.id].canton;
      existingMap[job.id].type = job.type || existingMap[job.id].type;
      existingMap[job.id].metier = job.metier || existingMap[job.id].metier;
    } else {
      // Nouveau poste
      existingMap[job.id] = {
        ...job,
        first_seen: job.first_seen || now,
        last_seen: now,
      };
      newCount++;
    }
  });

  // Sauvegarder
  const merged = {
    jobs: Object.values(existingMap),
    updated: now,
  };
  writeJobs(merged);

  console.log(`📡 Sync: ${incoming.jobs.length} reçus, ${newCount} nouveaux, ${merged.jobs.length} total`);

  res.json({
    synced: incoming.jobs.length,
    new: newCount,
    total: merged.jobs.length,
    timestamp: now,
  });
}

// ═══════════════════════════════════════════════════════════════
// ROUTE 3 : POST /interest — Le membre clique "Intéressé"
// ═══════════════════════════════════════════════════════════════
function expressInterest(req, res) {
  const data = req.body;
  if (!data) {
    return res.status(400).json({ error: 'Missing body' });
  }

  const interests = readInterests();
  interests.push({
    job_title: data.job_title || '',
    job_hospital: data.job_hospital || '',
    candidate: data.candidate || {},
    timestamp: data.timestamp || new Date().toISOString(),
  });
  writeInterests(interests);

  console.log(`🤝 Intérêt: ${data.candidate?.metier || '?'} → ${data.job_title || '?'}`);

  res.json({ status: 'ok', message: 'Intérêt enregistré' });
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════
module.exports = function (app) {
  app.get('/jobs', getJobs);
  app.post('/jobs/sync', syncJobs);
  app.post('/interest', expressInterest);
  console.log('✅ Routes Jobs API chargées (/jobs, /jobs/sync, /interest)');
};
