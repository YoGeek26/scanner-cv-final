// ═══════════════════════════════════════════════════════════════
// SUISSE CARRIÈRE — ROUTES API POSTES (Express.js) v2
// ═══════════════════════════════════════════════════════════════
// GET  /jobs         → Liste des postes (pour le frontend)
// POST /jobs/sync    → Reçoit les postes du scraper Python
// POST /interest     → Enregistre un intérêt candidat
// GET  /health       → Keep-alive pour UptimeRobot (anti-sleep)
//
// FIX v2: Double stockage mémoire + fichier.
// Render Free efface le disque au sleep → on garde les jobs en
// mémoire tant que le serveur tourne, ET sur disque en backup.
// Un pinger externe (UptimeRobot) empêche le sleep.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ─── Fichier JSON backup ───
const JOBS_FILE = path.join(__dirname, 'jobs_data.json');
const INTERESTS_FILE = path.join(__dirname, 'interests_data.json');
const SYNC_SECRET = process.env.SYNC_SECRET || 'changez-moi';

// ─── STOCKAGE EN MÉMOIRE (survit tant que le process tourne) ───
let jobsCache = { jobs: [], updated: null };
let interestsCache = [];
let lastSyncTime = null;
let serverStartTime = new Date().toISOString();

// ─── Init: charger depuis le fichier au démarrage (si existe) ───
function initFromFile() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const data = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      if (data.jobs && data.jobs.length > 0) {
        jobsCache = data;
        lastSyncTime = data.updated;
        console.log(`📂 Jobs chargés depuis fichier: ${data.jobs.length} postes (synced: ${data.updated})`);
        return;
      }
    }
  } catch (e) {
    console.error('⚠️ Erreur lecture fichier jobs:', e.message);
  }
  console.log('📂 Aucun fichier jobs_data.json trouvé — en attente du prochain sync scraper');
}

// Charger au démarrage
initFromFile();

// ─── Helpers: écriture fichier (best-effort, non bloquant) ───
function saveToDisk() {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobsCache, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ Impossible d\'écrire jobs_data.json:', e.message);
  }
}

function saveInterestsToDisk() {
  try {
    fs.writeFileSync(INTERESTS_FILE, JSON.stringify(interestsCache, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ Impossible d\'écrire interests_data.json:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTE 1 : GET /jobs — Le frontend appelle ça
// ═══════════════════════════════════════════════════════════════
function getJobs(req, res) {
  // Filtrer les postes de moins de 30 jours
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const activeJobs = (jobsCache.jobs || []).filter(j => {
    return (j.last_seen || j.first_seen || '') > cutoff;
  });

  console.log(`📡 GET /jobs → ${activeJobs.length} postes actifs (${jobsCache.jobs.length} total en mémoire)`);

  res.json({
    jobs: activeJobs,
    count: activeJobs.length,
    updated: jobsCache.updated || new Date().toISOString(),
    _meta: {
      server_start: serverStartTime,
      last_sync: lastSyncTime,
      total_in_memory: jobsCache.jobs.length,
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// ROUTE 2 : POST /jobs/sync — Le scraper Python appelle ça
// ═══════════════════════════════════════════════════════════════
function syncJobs(req, res) {
  // Vérifier le secret
  const token = req.headers['x-sync-token'] || '';
  if (token !== SYNC_SECRET) {
    console.warn('🔒 Sync refusé: mauvais token');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const incoming = req.body;
  if (!incoming || !incoming.jobs) {
    return res.status(400).json({ error: "Missing 'jobs' array" });
  }

  // Construire un map des postes existants
  const existingMap = {};
  (jobsCache.jobs || []).forEach(j => {
    if (j.id) existingMap[j.id] = j;
  });

  let newCount = 0;
  const now = new Date().toISOString();

  // Merger les postes
  incoming.jobs.forEach(job => {
    if (!job.id) return;
    if (existingMap[job.id]) {
      // Mettre à jour last_seen + champs
      existingMap[job.id].last_seen = now;
      existingMap[job.id].title = job.title || existingMap[job.id].title;
      existingMap[job.id].url = job.url || existingMap[job.id].url;
      existingMap[job.id].department = job.department || existingMap[job.id].department;
      existingMap[job.id].canton = job.canton || existingMap[job.id].canton;
      existingMap[job.id].type = job.type || existingMap[job.id].type;
      existingMap[job.id].metier = job.metier || existingMap[job.id].metier;
    } else {
      existingMap[job.id] = {
        ...job,
        first_seen: job.first_seen || now,
        last_seen: now,
      };
      newCount++;
    }
  });

  // Sauvegarder en mémoire
  jobsCache = {
    jobs: Object.values(existingMap),
    updated: now,
  };
  lastSyncTime = now;

  // Sauvegarder sur disque (best-effort)
  saveToDisk();

  console.log(`📡 Sync: ${incoming.jobs.length} reçus, ${newCount} nouveaux, ${jobsCache.jobs.length} total en mémoire`);

  res.json({
    synced: incoming.jobs.length,
    new: newCount,
    total: jobsCache.jobs.length,
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

  const entry = {
    job_title: data.job_title || '',
    job_hospital: data.job_hospital || '',
    candidate: data.candidate || {},
    timestamp: data.timestamp || new Date().toISOString(),
  };

  interestsCache.push(entry);
  saveInterestsToDisk();

  console.log(`🤝 Intérêt: ${data.candidate?.metier || '?'} → ${data.job_title || '?'}`);

  res.json({ status: 'ok', message: 'Intérêt enregistré' });
}

// ═══════════════════════════════════════════════════════════════
// ROUTE 4 : GET /health — Keep-alive pour UptimeRobot
// ═══════════════════════════════════════════════════════════════
function healthCheck(req, res) {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    jobs_count: jobsCache.jobs.length,
    last_sync: lastSyncTime,
    server_start: serverStartTime,
  });
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════
module.exports = function (app) {
  app.get('/jobs', getJobs);
  app.post('/jobs/sync', syncJobs);
  app.post('/interest', expressInterest);
  app.get('/health', healthCheck);
  console.log('✅ Routes Jobs API v2 chargées (/jobs, /jobs/sync, /interest, /health)');
  console.log(`   📊 ${jobsCache.jobs.length} postes en mémoire au démarrage`);
};
