// --- PATCH POUR STACKBLITZ & RENDER ---
global.DOMMatrix = class {};
global.ImageData = class {};
global.Path2D = class {};
// -----------------------------

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const cors = require('cors');

// MOTEUR PDF MOZILLA (Version 2.16 Legacy)
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// ═══ MAKE WEBHOOK — même URL que le simulateur salaire ═══
// Dans .env sur Render : MAKE_WEBHOOK_URL=https://hook.eu2.make.com/ton-id
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || '';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// --- FONCTION D'EXTRACTION PDF ---
async function extractTextFromPDF(buffer) {
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: data });
  const doc = await loadingTask.promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

// ═══════════════════════════════════════════════════════════════
// QUALIFICATION CV → Même tiers que le simulateur salaire
// ═══════════════════════════════════════════════════════════════
function qualifyFromCV(extracted, cvScore) {
  let score = 0, maxScore = 0;

  const metierScores = { IDE: 10, IADE: 14, IBODE: 13, AS: 7, SF: 10, TECH: 8, CADRE_SANTE: 11, EXECUTIVE: 6, AUTRE: 4 };
  maxScore += 14;
  score += metierScores[extracted.metier] || 4;

  const exp = extracted.experience_annees || 0;
  maxScore += 12;
  if (exp >= 6) score += 12; else if (exp >= 3) score += 10; else if (exp >= 1) score += 5; else score += 2;

  const tensionSpecs = ['réanimation', 'réa', 'soins intensifs', 'urgences', 'bloc', 'bloc opératoire', 'anesthésie'];
  const specs = (extracted.specialites || []).concat(extracted.services || []).map(s => s.toLowerCase());
  maxScore += 14;
  if (specs.some(s => tensionSpecs.some(t => s.includes(t)))) score += 14;
  else if (specs.some(s => ['chirurgie', 'pédiatrie', 'néonat'].some(t => s.includes(t)))) score += 10;
  else if (specs.length > 0) score += 6; else score += 3;

  maxScore += 15;
  if (extracted.statut_crs === 'obtenue') score += 15;
  else if (extracted.statut_crs === 'en_cours') score += 10;
  else if (extracted.mention_crs) score += 6; else score += 1;

  const FRONT_DEPTS = ['74', '01', '25', '39', '68', '90'];
  const PROCHE_DEPTS = ['69', '73', '38', '42', '71', '21', '70', '88', '67', '57', '54'];
  maxScore += 14;
  if (FRONT_DEPTS.includes(extracted.departement)) score += 14;
  else if (PROCHE_DEPTS.includes(extracted.departement)) score += 7;
  else if (extracted.ville_actuelle && extracted.ville_actuelle.toLowerCase().includes('suisse')) score += 14;
  else score += 4;

  maxScore += 14;
  const dispo = (extracted.disponibilite || '').toLowerCase();
  if (dispo.includes('immédiat') || dispo === 'immédiate') score += 14;
  else if (dispo && dispo !== 'non_mentionnée') score += 8; else score += 3;

  maxScore += 12;
  if (cvScore >= 70) score += 12; else if (cvScore >= 50) score += 8; else if (cvScore >= 30) score += 4; else score += 1;

  const pct = Math.round((score / maxScore) * 100);
  const tier = pct >= 75 ? 'pepite' : pct >= 55 ? 'chaud' : pct >= 35 ? 'potentiel' : 'explorateur';
  return { pct, tier };
}

// ═══════════════════════════════════════════════════════════════
// ENVOI LEAD CV → Make → Google Sheet + Shopify + Brevo
// ═══════════════════════════════════════════════════════════════
async function sendCVLeadToMake(extracted, cvScore, candidatEmail) {
  if (!MAKE_WEBHOOK_URL) {
    console.log('⚠️ MAKE_WEBHOOK_URL non configuré — lead non envoyé');
    return;
  }

  const qual = qualifyFromCV(extracted, cvScore);

  const exp = extracted.experience_annees || 0;
  let experienceTranche = '3-5';
  if (exp < 1) experienceTranche = '<1';
  else if (exp <= 2) experienceTranche = '1-2';
  else if (exp <= 5) experienceTranche = '3-5';
  else if (exp <= 10) experienceTranche = '6-10';
  else experienceTranche = '10+';

  const metierMap = { IDE: 'ide', IADE: 'iade', IBODE: 'ibode', AS: 'as', SF: 'sf', TECH: 'autre', CADRE_SANTE: 'autre', EXECUTIVE: 'autre', AUTRE: 'autre' };

  const specsJoined = (extracted.specialites || []).concat(extracted.services || []).join(' ').toLowerCase();
  let specialiteCode = 'autre';
  if (specsJoined.includes('réa') || specsJoined.includes('soins intensifs')) specialiteCode = 'rea';
  else if (specsJoined.includes('urgence')) specialiteCode = 'urgences';
  else if (specsJoined.includes('bloc') || specsJoined.includes('opératoire')) specialiteCode = 'bloc';
  else if (specsJoined.includes('pédiat') || specsJoined.includes('néonat')) specialiteCode = 'pediatrie';
  else if (specsJoined.includes('chirurg')) specialiteCode = 'chirurgie';
  else if (specsJoined.includes('psych')) specialiteCode = 'psychiatrie';
  else if (specsJoined.includes('gériat') || specsJoined.includes('ems')) specialiteCode = 'geriatrie';
  else if (specsJoined.includes('médecine')) specialiteCode = 'medecine';

  const crsMap = { obtenue: 'obtenue', en_cours: 'en_cours', 'non_mentionné': 'recherche' };

  const FRONT_DEPTS = ['74', '01', '25', '39', '68', '90'];
  const PROCHE_DEPTS = ['69', '73', '38', '42', '71', '21', '70', '88', '67', '57', '54'];
  let locCode = 'france';
  if (FRONT_DEPTS.includes(extracted.departement)) locCode = 'frontalier';
  else if (PROCHE_DEPTS.includes(extracted.departement)) locCode = 'proche';

  const dispoRaw = (extracted.disponibilite || '').toLowerCase();
  let dispoCode = '3_6_mois';
  if (dispoRaw.includes('immédiat')) dispoCode = 'immediat';
  else if (dispoRaw.includes('1 mois') || dispoRaw.includes('sous 1')) dispoCode = '1_mois';
  else if (dispoRaw.includes('2') || dispoRaw.includes('3 mois')) dispoCode = '2_3_mois';

  const prenom = extracted.nom ? extracted.nom.split(' ')[0] : 'Inconnu';

  // Même structure que le simulateur salaire + champs bonus CV
  const payload = {
    prenom,
    email: extracted.email || candidatEmail || '',
    metier: metierMap[extracted.metier] || 'autre',
    experience: experienceTranche,
    specialite: specialiteCode,
    canton: 'flexible',
    croix_rouge: crsMap[extracted.statut_crs] || 'recherche',
    localisation: locCode,
    disponibilite: dispoCode,
    salaire_net: 0,
    gain_annuel: 0,
    score_pct: qual.pct,
    tier: qual.tier,
    source: 'cv_scanner',
    timestamp: new Date().toISOString(),
    // Bonus CV (colonnes supplémentaires dans le Sheet)
    nom_complet: extracted.nom || '',
    telephone: extracted.telephone || '',
    cv_score: cvScore,
    diplome: extracted.diplome_principal || '',
    specialites_detail: (extracted.specialites || []).join(', '),
    services_detail: (extracted.services || []).join(', '),
    ville: extracted.ville_actuelle || '',
    departement: extracted.departement || '',
  };

  try {
    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`✅ Lead CV → Make (${qual.tier} ${qual.pct}%) :`, extracted.nom);
  } catch (err) {
    console.error('❌ Erreur envoi Make:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT IA — SCANNER CV (v2 : Audit + Extraction structurée)
// ═══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `
Tu es un expert en recrutement suisse (Canton de Genève/Vaud/Valais). Analyse le CV fourni.

═══════════════════════════════════════
ÉTAPE 1 : EXTRACTION STRUCTURÉE
═══════════════════════════════════════
Extrais les données factuelles du CV. Si une info n'est pas trouvée, mets null.
Sois PRÉCIS : ne déduis pas ce qui n'est pas écrit.

Règles d'extraction :
- "metier" : classe dans UNE catégorie : "AS", "IDE", "IADE", "IBODE", "SF", "TECH", "CADRE_SANTE", "EXECUTIVE", "AUTRE".
- "experience_annees" : calcule à partir des dates des postes.
- "mention_crs" : true UNIQUEMENT si le CV mentionne "Croix-Rouge", "CRS", "PreCheck" ou "NAREG".
- "statut_crs" : "obtenue" / "en_cours" / "non_mentionné".
- "employeurs" : liste les postes (ordre chronologique inverse).
- "ville_actuelle" : déduis de l'adresse postale.

═══════════════════════════════════════
ÉTAPE 2 : DÉTECTION DU PROFIL
═══════════════════════════════════════
MÉDICAL (Infirmier, AS, IADE, SF, Tech) ou EXECUTIVE (Finance, Manager, IT).

═══════════════════════════════════════
ÉTAPE 3 : AUDIT QUALITÉ
═══════════════════════════════════════
>> SI MÉDICAL : Critique CRS (alerte rouge si absent), compétences techniques, format CV.
>> SI EXECUTIVE : Critique chiffres/KPIs (alerte rouge si absents), style factuel.

═══════════════════════════════════════
ÉTAPE 4 : JSON STRICT
═══════════════════════════════════════
{
  "extracted_data": {
    "nom": "string ou null",
    "email": "string ou null",
    "telephone": "string ou null",
    "metier": "AS|IDE|IADE|IBODE|SF|TECH|CADRE_SANTE|EXECUTIVE|AUTRE",
    "diplome_principal": "string ou null",
    "annee_diplome": 2019,
    "specialites": ["Bloc opératoire"],
    "services": ["Cardiologie", "Urgences"],
    "experience_annees": 5,
    "employeurs": [{"nom":"CHU Lyon","poste":"IDE","service":"Cardio","debut":"2021-09","fin":"présent"}],
    "langues": ["Français (natif)"],
    "formations_complementaires": ["AFGSU 2"],
    "mention_crs": false,
    "statut_crs": "obtenue|en_cours|non_mentionné",
    "ville_actuelle": "string ou null",
    "departement": "74 ou null",
    "disponibilite": "immédiate|2025-03|non_mentionnée",
    "a_photo": true,
    "nombre_pages_estime": 2,
    "references_mentionnees": false
  },
  "score": 65,
  "detected_profile": "MÉDICAL",
  "summary": "J'ai analysé votre profil... (3-4 phrases max)",
  "missing_keywords": ["Red Flag 1", "Red Flag 2", "Red Flag 3"],
  "recommendations": ["Point Fort 1", "Point Fort 2", "Conseil"]
}
`;

// --- PROMPT IA LETTRE DE MOTIVATION (inchangé) ---
const LETTER_PROMPT = `Tu es un expert en recrutement médical suisse, spécialisé dans l'accompagnement des soignants français vers la Suisse romande (Genève, Vaud, Valais).

Ta mission : Rédiger une lettre de motivation PARFAITE, prête à envoyer, pour un poste dans le secteur médical suisse.

RÈGLES DE RÉDACTION :
1. FORMAT SUISSE STRICT :
   - Coordonnées expéditeur en haut à gauche
   - Coordonnées destinataire en dessous
   - Lieu et date
   - Objet clair
   - Corps de lettre structuré
   - Formule de politesse formelle suisse
   - Mention des pièces jointes

2. STRUCTURE DU CORPS :
   - Paragraphe 1 (VOUS) : Pourquoi cet établissement vous attire
   - Paragraphe 2 (MOI) : Parcours et compétences clés avec des faits concrets
   - Paragraphe 3 (NOUS) : Ce que vous apporterez + reconnaissance CRS + disponibilité
   - Conclusion : Demande d'entretien + formule de politesse

3. TON : Professionnel, confiant, factuel, adapté à la culture suisse.

4. IMPORTANT :
   - Mentionne TOUJOURS le statut Croix-Rouge
   - Si frontalier, mentionne sa mobilité
   - Termine par la liste des pièces jointes

GÉNÈRE UNIQUEMENT LA LETTRE, sans commentaire.`;

// ═══════════════════════════════════════════════════════════════
// ROUTE 1 : PAGE D'ACCUEIL (Test interne)
// ═══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Scanner CV Suisse (Universel)</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; background: #f8fafc; color: #333; }
          .container { background: white; padding: 50px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; border: 1px solid #eee; }
          h1 { color: #0f172a; letter-spacing: -0.5px; margin-bottom: 10px; font-weight: 800; font-size: 32px; }
          input[type=email] { padding: 14px; width: 100%; max-width: 400px; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 15px; font-size: 16px; }
          input[type=file] { margin-top: 10px; font-size: 14px; background: #f1f5f9; padding: 10px; border-radius: 6px; width: 100%; max-width: 400px; }
          button { background: #0f172a; color: white; padding: 16px 32px; border: none; cursor: pointer; font-size: 16px; margin-top: 25px; border-radius: 6px; font-weight: 600; width: 100%; max-width: 400px; transition: transform 0.1s; }
          button:hover { transform: scale(1.02); }
          #result { margin-top: 50px; text-align: left; }
          .loader-container { margin-top: 30px; text-align: center; display: none; }
          .loader-text { font-size: 14px; color: #64748b; font-weight: 600; margin-bottom: 10px; }
          .progress-bar { width: 100%; max-width: 400px; height: 6px; background: #e2e8f0; border-radius: 10px; margin: 0 auto; overflow: hidden; position: relative; }
          .progress-fill { height: 100%; background: #0f172a; width: 0%; border-radius: 10px; transition: width 0.3s; animation: loading 3s ease-in-out infinite; }
          @keyframes loading { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🛡️ Scanner Suisse IA</h1>
          <p style="color:#64748b; margin-bottom:30px;">Analyse compatible Médical & Executive</p>
          <form id="uploadForm">
            <input type="email" name="user_email" placeholder="Email du candidat" required />
            <br>
            <input type="file" name="cv_file" accept=".pdf,.docx" required />
            <br>
            <button type="submit">Lancer l'audit gratuit</button>
          </form>
          <div id="loader" class="loader-container">
            <div class="loader-text" id="loaderText">Initialisation du scanner...</div>
            <div class="progress-bar"><div class="progress-fill"></div></div>
          </div>
        </div>
        <div id="result"></div>
        <script>
          const form = document.getElementById('uploadForm');
          const resultDiv = document.getElementById('result');
          const loader = document.getElementById('loader');
          const loaderText = document.getElementById('loaderText');
          const btn = document.querySelector('button');
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            resultDiv.innerHTML = "";
            loader.style.display = "block";
            btn.style.display = "none";
            const steps = ["📂 Lecture du fichier...", "🧠 Détection du profil (Médical vs Executive)...", "🔍 Extraction des données structurées...", "🇨🇭 Comparaison avec les standards suisses...", "📊 Calcul du score de conformité..."];
            let stepIndex = 0;
            const interval = setInterval(() => { stepIndex = (stepIndex + 1) % steps.length; loaderText.textContent = steps[stepIndex]; }, 1500);
            const formData = new FormData(e.target);
            try {
              const res = await fetch('/scan', { method: 'POST', body: formData });
              const htmlContent = await res.text();
              clearInterval(interval);
              loader.style.display = "none";
              btn.style.display = "inline-block";
              resultDiv.innerHTML = htmlContent;
              resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (err) {
              clearInterval(interval);
              loader.style.display = "none";
              btn.style.display = "inline-block";
              resultDiv.innerHTML = "<div style='color:red; text-align:center; padding:20px; background:#fff1f2; border-radius:8px;'>❌ Erreur : " + err.message + "</div>";
            }
          });
        </script>
      </body>
    </html>
  `);
});

// ═══════════════════════════════════════════════════════════════
// ROUTE 2 : SCAN CV (v2 — extraction + Make + email fix + speed)
// ═══════════════════════════════════════════════════════════════
app.post('/scan', upload.single('cv_file'), async (req, res) => {
  const wantJson = req.query.format === 'json'
    || (req.headers.accept && req.headers.accept.includes('application/json'));

  try {
    if (!req.file) {
      if (wantJson) return res.status(400).json({ error: 'Fichier manquant' });
      return res.status(400).send('Fichier manquant');
    }

    let text = '';
    console.log('📂 Fichier reçu :', req.file.mimetype);

    if (req.file.mimetype === 'application/pdf') {
      try {
        text = await extractTextFromPDF(req.file.buffer);
      } catch (pdfErr) {
        console.error('Erreur PDF:', pdfErr);
        throw new Error('Impossible de lire ce PDF.');
      }
    } else if (req.file.originalname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    } else {
      if (wantJson) return res.status(400).json({ error: 'Format non supporté' });
      return res.status(400).send('Format non supporté (PDF ou DOCX uniquement)');
    }

    if (!text || text.length < 20) {
      if (wantJson) return res.status(400).json({ error: 'Fichier illisible' });
      return res.status(400).send('Fichier illisible.');
    }

    console.log(`📝 Texte extrait : ${text.length} caractères`);

    // ── FIX VITESSE : tronquer les CV trop longs ──
    if (text.length > 6000) {
      console.log(`✂️ Tronqué de ${text.length} → 6000 chars`);
      text = text.substring(0, 6000);
    }

    // ── FIX VITESSE : timeout 60s + modèle rapide ──
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyse ce CV (RÉPONDRE EN FRANÇAIS) :\n${text}` },
        ],
        response_format: { type: 'json_object' },
      }),
    }).finally(() => clearTimeout(timeout));

    const aiJson = await response.json();
    if (aiJson.error) throw new Error('Erreur IA: ' + (aiJson.error.message || 'Erreur inconnue'));

    // ── Parse la réponse IA ──
    let content;
    try {
      const raw = aiJson.choices[0].message.content;
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      content = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('❌ Parse JSON IA:', parseErr);
      console.error('Brut:', aiJson.choices[0].message.content);
      throw new Error('L\'IA a retourné un format invalide. Réessayez.');
    }

    if (content.score < 1) content.score = Math.round(content.score * 100);

    // ── Nettoyer extracted_data ──
    const extracted = content.extracted_data || {};

    if (extracted.metier && !['AS', 'IDE', 'IADE', 'IBODE', 'SF', 'TECH', 'CADRE_SANTE', 'EXECUTIVE', 'AUTRE'].includes(extracted.metier)) {
      const norm = { 'INFIRMIER': 'IDE', 'INFIRMIERE': 'IDE', 'INFIRMIÈRE': 'IDE', 'AIDE-SOIGNANT': 'AS', 'AIDE-SOIGNANTE': 'AS', 'SAGE-FEMME': 'SF', 'ANESTHESISTE': 'IADE', 'ANESTHÉSISTE': 'IADE', 'BLOC': 'IBODE', 'CADRE': 'CADRE_SANTE' };
      extracted.metier = norm[extracted.metier.toUpperCase()] || extracted.metier;
    }

    ['specialites', 'services', 'langues', 'formations_complementaires', 'employeurs'].forEach(f => {
      if (extracted[f] && !Array.isArray(extracted[f])) extracted[f] = [extracted[f]];
    });

    console.log('✅ Extraction :', extracted.nom, '|', extracted.metier, '|', extracted.experience_annees, 'ans');

    // ── Rapport HTML (mobile responsive) ──
    const htmlReport = generateReportHtml(content);

    // ══════════════════════════════════════════════
    // EMAIL CANDIDAT — Resend (+ log diagnostic)
    // ══════════════════════════════════════════════
    let emailMessage = '';
    if (req.body.user_email) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Audit Suisse Carrière <bonjour@suisse-carriere.com>',
            to: req.body.user_email,
            bcc: 'chaborel@gmail.com',
            subject: `Résultat de votre Audit (${content.score}/100)`,
            html: htmlReport,
          }),
        });

        // ── FIX : Log détaillé pour diagnostiquer ──
        const emailBody = await emailRes.json();
        if (!emailRes.ok) {
          console.error('❌ RESEND ERREUR:', emailRes.status, JSON.stringify(emailBody));
          throw new Error(`Resend ${emailRes.status}: ${emailBody.message || JSON.stringify(emailBody)}`);
        }
        console.log('✅ Email Resend OK →', req.body.user_email, '| ID:', emailBody.id);
        emailMessage = `<div style="background:#dcfce7; color:#14532d; padding:12px; border-radius:6px; text-align:center; margin-bottom:30px; border:1px solid #bbf7d0; font-weight:600;">✅ Rapport envoyé à ${req.body.user_email}</div>`;

      } catch (e) {
        console.error('❌ Email non envoyé:', e.message);
        emailMessage = `<div style="background:#fff7ed; color:#9a3412; padding:12px; border-radius:6px; text-align:center; margin-bottom:30px; border:1px solid #ffedd5; font-size:13px;">⚠️ Email non envoyé (${e.message}), mais voici votre résultat :</div>`;
      }
    }

    // ══════════════════════════════════════════════
    // LEAD → Make → Google Sheet + Shopify + Brevo
    // ══════════════════════════════════════════════
    await sendCVLeadToMake(extracted, content.score, req.body.user_email);

    // ── Réponse ──
    if (wantJson) {
      return res.json({
        report: htmlReport,
        extracted_data: extracted,
        score: content.score,
        detected_profile: content.detected_profile || null,
        summary: content.summary || null,
        missing_keywords: content.missing_keywords || [],
        recommendations: content.recommendations || [],
        email_status: emailMessage,
      });
    }

    res.send(emailMessage + htmlReport);

  } catch (error) {
    console.error('❌ Erreur Backend:', error);
    const isTimeout = error.name === 'AbortError';
    const msg = isTimeout ? 'Analyse trop longue (>60s). Réessayez.' : error.message;
    if (wantJson) return res.status(500).json({ error: msg });
    res.status(500).send(`<div style="color:red; text-align:center; padding:20px;">Erreur : ${msg}</div>`);
  }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE 3 : GÉNÉRATION LETTRE DE MOTIVATION
// ═══════════════════════════════════════════════════════════════
app.post('/generate-letter', async (req, res) => {
  try {
    const data = req.body;
    console.log('✉️ Génération lettre pour:', data.nom);

    const userPrompt = `Génère une lettre de motivation pour ce candidat (RÉPONDRE EN FRANÇAIS) :

INFORMATIONS DU CANDIDAT :
- Nom complet : ${data.nom || 'Non précisé'}
- Adresse : ${data.adresse || 'Non précisée'}
- Téléphone : ${data.telephone || 'Non précisé'}
- Email : ${data.email || 'Non précisé'}
- Métier : ${data.metier || 'Non précisé'}
- Années d'expérience : ${data.experience || 'Non précisé'}
- Service actuel : ${data.service || 'Non précisé'}
- Établissement actuel : ${data.hopitalActuel || 'Non précisé'}
- Compétences clés : ${data.competences || 'Non précisées'}
- Statut reconnaissance Croix-Rouge : ${data.reconnaissance === 'obtenue' ? 'Obtenue' : data.reconnaissance === 'en_cours' ? 'En cours de traitement' : 'Pas encore demandée'}
- Disponibilité : ${data.disponibilite || 'Immédiate'}

ÉTABLISSEMENT CIBLÉ :
- Nom : ${data.etablissement || 'Non précisé'}
- Service visé : ${data.serviceVise || 'Non précisé'}
- Adresse : ${data.adresseEtab || 'Non précisée'}
- Référence offre : ${data.reference || 'Candidature spontanée'}
- Motivation pour cet établissement : ${data.motivation || 'Non précisée'}

Génère la lettre complète, prête à être copiée et envoyée.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        temperature: 0.7,
        messages: [
          { role: 'system', content: LETTER_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const aiJson = await response.json();

    if (aiJson.error) {
      console.error('Erreur OpenRouter:', aiJson.error);
      throw new Error('Erreur IA: ' + (aiJson.error.message || 'Erreur inconnue'));
    }

    const letter = aiJson.choices[0].message.content;
    res.json({ success: true, letter: letter });
  } catch (error) {
    console.error('❌ Erreur génération lettre:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SERVEUR
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend Suisse Carrière v2 prêt sur port ${PORT}`));

// ═══════════════════════════════════════════════════════════════
// RAPPORT HTML — Mobile Responsive
// ═══════════════════════════════════════════════════════════════
function generateReportHtml(data) {
  const color = data.score >= 70 ? '#10b981' : data.score >= 40 ? '#f59e0b' : '#ef4444';
  const redFlags = data.missing_keywords || ['Aucun point bloquant majeur détecté.'];
  const greenPoints = data.recommendations || ['Profil globalement intéressant.'];

  return `
    <style>
      .sc-rpt,.sc-rpt *{box-sizing:border-box}
      .sc-rpt{font-family:'Inter',Helvetica,sans-serif;max-width:700px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
      .sc-rpt-h{background:#0f172a;color:#fff;padding:28px 20px;text-align:center}
      .sc-rpt-h h2{margin:0;font-weight:800;font-size:20px}
      .sc-rpt-h p{margin:5px 0 0;opacity:.8;font-size:12px;text-transform:uppercase;letter-spacing:1px}
      .sc-rpt-b{padding:20px}
      .sc-rpt-sc{text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #f1f5f9}
      .sc-rpt-num{font-size:56px;font-weight:900;color:${color};line-height:1}
      .sc-rpt-num span{font-size:24px;color:#cbd5e1;font-weight:600}
      .sc-rpt-lbl{text-transform:uppercase;font-size:11px;color:#64748b;margin-top:10px;font-weight:700;letter-spacing:1px}
      .sc-rpt-v{background:#f8fafc;padding:18px;border-left:4px solid #0f172a;margin-bottom:28px;border-radius:0 8px 8px 0}
      .sc-rpt-v strong{color:#0f172a;display:block;margin-bottom:6px;font-size:12px;text-transform:uppercase}
      .sc-rpt-v span{line-height:1.6;color:#334155;font-size:13px}
      .sc-rpt-cols{margin-bottom:28px}
      .sc-rpt-col{margin-bottom:20px}
      .sc-rpt-col h3{padding-bottom:8px;font-size:14px;margin:0 0 8px}
      .sc-rpt-col ul{padding-left:16px;color:#475569;font-size:13px;line-height:1.7;margin:0}
      .sc-rpt-col li{margin-bottom:4px}
      .sc-rpt-cta{text-align:center;background:#fff0f3;padding:20px;border-radius:8px;border:1px solid #ffc9d6;margin-top:28px}
      .sc-rpt-cta h3{color:#be123c;margin:0 0 8px;font-size:17px}
      .sc-rpt-cta p{margin:0 0 16px;color:#555;font-size:13px;line-height:1.5}
      .sc-rpt-cta a{background:#d90429;color:#fff!important;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;display:inline-block;font-size:14px}
      .sc-rpt-ft{margin-top:28px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:14px}
      @media(min-width:600px){
        .sc-rpt-h{padding:40px}.sc-rpt-b{padding:40px}
        .sc-rpt-h h2{font-size:24px}.sc-rpt-num{font-size:72px}
        .sc-rpt-cols{display:flex;gap:32px}.sc-rpt-col{flex:1;margin-bottom:0}
      }
    </style>
    <div class="sc-rpt">
      <div class="sc-rpt-h">
        <h2>Audit de Conformité Suisse 🇨🇭</h2>
        <p>Profil détecté : ${data.detected_profile || 'Non spécifié'}</p>
      </div>
      <div class="sc-rpt-b">
        <div class="sc-rpt-sc">
          <div class="sc-rpt-num">${data.score}<span>/100</span></div>
          <div class="sc-rpt-lbl">Score de Compatibilité</div>
        </div>
        <div class="sc-rpt-v">
          <strong>Verdict de l'IA</strong>
          <span>${data.summary}</span>
        </div>
        <div class="sc-rpt-cols">
          <div class="sc-rpt-col">
            <h3 style="color:#ef4444;border-bottom:2px solid #fee2e2">🚩 Points Bloquants</h3>
            <ul>${redFlags.map(k => '<li>' + k + '</li>').join('')}</ul>
          </div>
          <div class="sc-rpt-col">
            <h3 style="color:#10b981;border-bottom:2px solid #dcfce7">✅ Points Forts</h3>
            <ul>${greenPoints.map(r => '<li>' + r + '</li>').join('')}</ul>
          </div>
        </div>
        <div class="sc-rpt-cta">
          <h3>Ne laissez pas l'ATS rejeter ce CV.</h3>
          <p>Votre profil a du potentiel mais ne respecte pas les codes suisses.</p>
          <a href="https://suisse-carriere.com" target="_blank">👉 Voir les Packs de correction</a>
        </div>
        <div class="sc-rpt-ft">Généré par Suisse Carrière Intelligence v2</div>
      </div>
    </div>
  `;
}
