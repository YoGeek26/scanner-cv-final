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
- "metier" : classe le profil dans UNE des catégories suivantes UNIQUEMENT :
  "AS" (Aide-Soignant/ASSC), "IDE" (Infirmier Diplômé d'État), "IADE" (Infirmier Anesthésiste),
  "IBODE" (Infirmier de Bloc Opératoire), "SF" (Sage-Femme), "TECH" (Technicien médical/labo/radio),
  "CADRE_SANTE" (Cadre de santé/ICUS), "EXECUTIVE" (profil non-médical), "AUTRE".
- "experience_annees" : calcule à partir des dates des postes (pas de la date du diplôme).
- "mention_crs" : true UNIQUEMENT si le CV mentionne explicitement "Croix-Rouge", "CRS",
  "reconnaissance suisse", "PreCheck" ou "NAREG". Un simple séjour en Suisse ne compte pas.
- "statut_crs" : "obtenue" si une date de validation est mentionnée, "en_cours" si le mot
  "en cours" ou "déposé" apparaît, "non_mentionné" sinon.
- "employeurs" : liste TOUS les postes dans l'ordre chronologique inverse (le plus récent d'abord).
  Pour chaque poste, extrais le nom de l'établissement, le poste, le service, et les dates.
- "ville_actuelle" : déduis de l'adresse postale sur le CV. Si seulement un département, mets le département.

═══════════════════════════════════════
ÉTAPE 2 : DÉTECTION DU PROFIL
═══════════════════════════════════════
Détermine si le candidat est un profil MÉDICAL (Infirmier, Aide-Soignant, IADE, Sage-Femme, Tech)
ou EXECUTIVE (Finance, Manager, IT, Admin, Ingénieur).

═══════════════════════════════════════
ÉTAPE 3 : AUDIT QUALITÉ
═══════════════════════════════════════

>> SI MÉDICAL (Santé) :
- Critique la reconnaissance diplôme : Vérifie s'il mentionne la Croix-Rouge ou PreCheck.
  Sinon, c'est une ALERTE ROUGE.
- Critique les compétences techniques : Cherche des détails précis (Soins, Services, Machines).
  Le CV ne doit pas être vague.
- Vérifie le format : Photo ? 2 pages max ? Références mentionnées ?
- Ton : Empathique mais strict sur les certifications.

>> SI EXECUTIVE (Cadre/Banque) :
- Critique les chiffres : Cherche des résultats chiffrés (KPIs, Budgets gérés).
  S'il n'y en a pas, c'est une ALERTE ROUGE.
- Critique le style : Vérifie si le ton est trop "littéraire/français".
  Exige un style factuel "Bullet points".
- Ton : Professionnel, direct, orienté ROI.

═══════════════════════════════════════
ÉTAPE 4 : GÉNÉRATION DU JSON
═══════════════════════════════════════
Donne une note sur 100.

FORMAT JSON STRICT (pas de texte autour, juste le JSON) :
{
  "extracted_data": {
    "nom": "Prénom NOM tel qu'écrit sur le CV ou null",
    "email": "email trouvé dans le CV ou null",
    "telephone": "numéro trouvé ou null (format original)",
    "metier": "AS | IDE | IADE | IBODE | SF | TECH | CADRE_SANTE | EXECUTIVE | AUTRE",
    "diplome_principal": "Intitulé exact du diplôme principal ou null",
    "annee_diplome": 2019,
    "specialites": ["Bloc opératoire", "Réanimation"],
    "services": ["Cardiologie", "Urgences", "Chirurgie"],
    "experience_annees": 5,
    "employeurs": [
      {
        "nom": "CHU Lyon",
        "poste": "Infirmière DE",
        "service": "Cardiologie",
        "debut": "2021-09",
        "fin": "présent"
      }
    ],
    "langues": ["Français (natif)", "Anglais (B2)"],
    "formations_complementaires": ["AFGSU 2", "DU Plaies et Cicatrisation"],
    "mention_crs": false,
    "statut_crs": "obtenue | en_cours | non_mentionné",
    "ville_actuelle": "Annemasse ou null",
    "departement": "74 ou null",
    "disponibilite": "immédiate | 2025-03 | non_mentionnée",
    "a_photo": true,
    "nombre_pages_estime": 2,
    "references_mentionnees": false
  },
  "score": 65,
  "detected_profile": "MÉDICAL ou EXECUTIVE",
  "summary": "Commence par : 'J'ai analysé votre profil [TYPE]...' puis donne ton verdict exécutif en 3-4 phrases max.",
  "missing_keywords": [
    "Point Bloquant 1 (Red Flag)",
    "Point Bloquant 2 (Red Flag)",
    "Point Bloquant 3 (Red Flag)"
  ],
  "recommendations": [
    "Point Fort 1 (Validé)",
    "Point Fort 2 (Validé)",
    "Conseil rapide pour passer la barre"
  ]
}
`;

// ═══════════════════════════════════════════════════════════════
// PROMPT IA — LETTRE DE MOTIVATION
// ═══════════════════════════════════════════════════════════════
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
   - Paragraphe 1 (VOUS) : Pourquoi cet établissement vous attire (montrer qu'on a fait ses recherches)
   - Paragraphe 2 (MOI) : Parcours et compétences clés avec des faits concrets
   - Paragraphe 3 (NOUS) : Ce que vous apporterez + reconnaissance CRS + disponibilité
   - Conclusion : Demande d'entretien + formule de politesse

3. TON :
   - Professionnel mais pas froid
   - Confiant sans être arrogant
   - Factuel (éviter les superlatifs vagues)
   - Adapté à la culture suisse (précision, modestie, fiabilité)

4. IMPORTANT :
   - Mentionne TOUJOURS le statut de reconnaissance Croix-Rouge
   - Si le candidat est frontalier, mentionne sa mobilité
   - Termine TOUJOURS par la liste des pièces jointes

GÉNÈRE UNIQUEMENT LA LETTRE, sans aucun commentaire avant ou après. La lettre doit être prête à copier-coller.`;

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
// ROUTE 2 : SCAN CV (v2 — Audit + Extraction structurée)
// ═══════════════════════════════════════════════════════════════
// Retourne maintenant du JSON (plus du HTML brut) pour permettre
// au dashboard de récupérer les données extraites.
//
// Format de réponse :
// {
//   "report": "<html>...</html>",        ← Rapport visuel (comme avant)
//   "extracted_data": { ... },           ← Données structurées du CV
//   "score": 65,                         ← Score brut
//   "detected_profile": "MÉDICAL",       ← Type de profil
//   "email_status": "<html>..."          ← Message d'envoi email (optionnel)
// }
// ═══════════════════════════════════════════════════════════════
app.post('/scan', upload.single('cv_file'), async (req, res) => {
  // ─── FORMAT DE RÉPONSE ───
  // Par défaut : HTML (rétrocompatible avec le frontend Shopify existant)
  // Si ?format=json ou header Accept: application/json → JSON (pour le dashboard)
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
      if (wantJson) return res.status(400).json({ error: 'Format non supporté (PDF ou DOCX uniquement)' });
      return res.status(400).send('Format non supporté (PDF ou DOCX uniquement)');
    }

    if (!text || text.length < 20) {
      if (wantJson) return res.status(400).json({ error: 'Fichier illisible ou trop court.' });
      return res.status(400).send('Fichier illisible.');
    }

    console.log(`📝 Texte extrait : ${text.length} caractères`);

    // --- Appel IA (audit + extraction) ---
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyse ce CV (RÉPONDRE EN FRANÇAIS) :\n${text}` },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    const aiJson = await response.json();
    if (aiJson.error) throw new Error('Erreur IA: ' + (aiJson.error.message || 'Erreur inconnue'));

    // --- Parse la réponse IA ---
    let content;
    try {
      const raw = aiJson.choices[0].message.content;
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      content = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('❌ Erreur parsing JSON IA:', parseErr);
      console.error('Contenu brut:', aiJson.choices[0].message.content);
      throw new Error('L\'IA a retourné un format invalide. Réessayez.');
    }

    // Normaliser le score
    if (content.score < 1) content.score = Math.round(content.score * 100);

    // Valider/nettoyer extracted_data
    const extracted = content.extracted_data || {};

    // S'assurer que les champs critiques ont un format cohérent
    if (extracted.metier && !['AS', 'IDE', 'IADE', 'IBODE', 'SF', 'TECH', 'CADRE_SANTE', 'EXECUTIVE', 'AUTRE'].includes(extracted.metier)) {
      const metierMap = {
        'INFIRMIER': 'IDE', 'INFIRMIERE': 'IDE', 'INFIRMIÈRE': 'IDE',
        'AIDE-SOIGNANT': 'AS', 'AIDE-SOIGNANTE': 'AS', 'AIDE SOIGNANT': 'AS',
        'SAGE-FEMME': 'SF', 'SAGE FEMME': 'SF',
        'ANESTHESISTE': 'IADE', 'ANESTHÉSISTE': 'IADE',
        'BLOC': 'IBODE', 'BLOC OPÉRATOIRE': 'IBODE',
        'CADRE': 'CADRE_SANTE',
      };
      const upper = extracted.metier.toUpperCase();
      extracted.metier = metierMap[upper] || extracted.metier;
    }

    // S'assurer que les arrays sont bien des arrays
    ['specialites', 'services', 'langues', 'formations_complementaires', 'employeurs'].forEach(field => {
      if (extracted[field] && !Array.isArray(extracted[field])) {
        extracted[field] = [extracted[field]];
      }
    });

    console.log('✅ Extraction réussie :', extracted.nom, '|', extracted.metier, '|', extracted.experience_annees, 'ans');

    // --- Générer le rapport HTML ---
    const htmlReport = generateReportHtml(content);

    // --- Email 1 : Rapport au candidat (propre, sans données extraites) ---
    let emailStatus = '';
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
            subject: `Résultat de votre Audit (${content.score}/100)`,
            html: htmlReport,
          }),
        });
        if (!emailRes.ok) throw new Error('Erreur API Resend');
        emailStatus = `<div style="background:#dcfce7; color:#14532d; padding:12px; border-radius:6px; text-align:center; margin-bottom:30px; border:1px solid #bbf7d0; font-weight:600;">✅ Rapport envoyé à ${req.body.user_email}</div>`;
      } catch (e) {
        emailStatus = `<div style="background:#fff7ed; color:#9a3412; padding:12px; border-radius:6px; text-align:center; margin-bottom:30px; border:1px solid #ffedd5; font-size:13px;">⚠️ Note : Email non envoyé (vérification domaine requise), mais voici le résultat :</div>`;
      }
    }

    // --- Email 2 : Fiche profil ADMIN (données extraites → toi) ---
    try {
      const adminHtml = generateAdminFicheHtml(extracted, content, req.body.user_email);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Scanner CV <bonjour@suisse-carriere.com>',
          to: process.env.ADMIN_EMAIL || 'chaborel@gmail.com',
          subject: `🆕 Profil extrait : ${extracted.nom || 'Inconnu'} — ${extracted.metier || '?'} — ${content.score}/100`,
          html: adminHtml,
        }),
      });
      console.log('📧 Fiche admin envoyée pour:', extracted.nom);
    } catch (e) {
      console.error('⚠️ Email admin non envoyé:', e.message);
      // On ne bloque pas la réponse si l'email admin échoue
    }

    // ─── RÉPONSE ───
    if (wantJson) {
      // Dashboard / API : réponse JSON complète avec extracted_data
      return res.json({
        report: htmlReport,
        extracted_data: extracted,
        score: content.score,
        detected_profile: content.detected_profile || null,
        summary: content.summary || null,
        missing_keywords: content.missing_keywords || [],
        recommendations: content.recommendations || [],
        email_status: emailStatus,
      });
    }

    // Shopify / Frontend existant : réponse HTML directe (comme avant)
    res.send(emailStatus + htmlReport);

  } catch (error) {
    console.error('❌ Erreur Backend:', error);
    if (wantJson) {
      return res.status(500).json({
        error: error.message,
        report: `<div style="color:red; text-align:center; padding:20px;">Erreur technique : ${error.message}</div>`,
      });
    }
    res.status(500).send(`<div style="color:red; text-align:center; padding:20px;">Erreur technique : ${error.message}</div>`);
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
        model: 'google/gemini-3-flash-preview',
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

    res.json({
      success: true,
      letter: letter,
    });
  } catch (error) {
    console.error('❌ Erreur génération lettre:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE 4 : PROFIL CANDIDAT COMPLET (NOUVEAU)
// ═══════════════════════════════════════════════════════════════
// Endpoint appelé par le dashboard pour fusionner :
//   - scannerData (du dashboard Mission 2)
//   - extracted_data (du scan CV Mission 3)
// et générer une fiche profil propre pour l'agence.
//
// POST /profile/merge
// Body : { scannerData: {...}, extractedData: {...}, cvScore: 65 }
// Response : { profile: {...}, ficheAgence: "texte résumé" }
// ═══════════════════════════════════════════════════════════════
app.post('/profile/merge', (req, res) => {
  try {
    const { scannerData = {}, extractedData = {}, cvScore = null } = req.body;

    // Fusion intelligente : extracted_data (CV) prime pour les faits,
    // scannerData (dashboard) prime pour les intentions/projets
    const profile = {
      // --- Identité (CV uniquement) ---
      nom: extractedData.nom || null,
      email: extractedData.email || scannerData.email || null,
      telephone: extractedData.telephone || null,

      // --- Métier : CV confirme, dashboard en fallback ---
      metier: extractedData.metier || scannerData.metier || null,
      diplome_principal: extractedData.diplome_principal || null,
      annee_diplome: extractedData.annee_diplome || null,

      // --- Expérience : CV est plus précis ---
      experience_annees: extractedData.experience_annees || scannerData.experience_tranche || null,
      specialites: extractedData.specialites || [],
      services: extractedData.services || [],
      employeurs: extractedData.employeurs || [],
      langues: extractedData.langues || [],
      formations_complementaires: extractedData.formations_complementaires || [],

      // --- CRS : CV vérifie, dashboard complète ---
      mention_crs: extractedData.mention_crs || false,
      statut_crs: extractedData.statut_crs !== 'non_mentionné'
        ? extractedData.statut_crs
        : (scannerData.statut_crs || 'non_mentionné'),

      // --- Projet Suisse (dashboard UNIQUEMENT, jamais dans un CV) ---
      statut: scannerData.statut || 'frontalier',
      zone_cible: scannerData.zone || scannerData.canton || 'indecis',
      situation_familiale: scannerData.situation || null,
      disponibilite: extractedData.disponibilite !== 'non_mentionnée'
        ? extractedData.disponibilite
        : (scannerData.disponibilite || null),

      // --- Qualité CV ---
      cv_score: cvScore,
      a_photo: extractedData.a_photo || false,
      references_mentionnees: extractedData.references_mentionnees || false,
      ville_actuelle: extractedData.ville_actuelle || null,

      // --- Métadonnées ---
      date_creation: new Date().toISOString(),
      source: 'suisse-carriere.com',
    };

    // --- Générer un résumé texte pour l'agence ---
    const metierLabels = {
      AS: 'Aide-Soignant(e)', IDE: 'Infirmier(e) DE', IADE: 'IADE',
      IBODE: 'IBODE', SF: 'Sage-Femme', TECH: 'Technicien(ne)',
      CADRE_SANTE: 'Cadre de Santé', EXECUTIVE: 'Profil Executive',
    };

    const statutLabels = { frontalier: 'Frontalier (Permis G)', resident: 'Résident (Permis B)' };
    const crsLabels = { obtenue: '✅ CRS obtenue', en_cours: '⏳ CRS en cours', 'non_mentionné': '❌ CRS non mentionnée' };
    const zoneLabels = { geneve: 'Genève', vaud: 'Vaud', valais: 'Valais', indecis: 'À définir' };

    const ficheAgence = [
      `═══ FICHE PROFIL CANDIDAT ═══`,
      ``,
      `Nom : ${profile.nom || '—'}`,
      `Métier : ${metierLabels[profile.metier] || profile.metier || '—'}`,
      `Diplôme : ${profile.diplome_principal || '—'}${profile.annee_diplome ? ' (' + profile.annee_diplome + ')' : ''}`,
      `Expérience : ${profile.experience_annees ? profile.experience_annees + ' ans' : '—'}`,
      `Spécialités : ${profile.specialites.length ? profile.specialites.join(', ') : '—'}`,
      `Services maîtrisés : ${profile.services.length ? profile.services.join(', ') : '—'}`,
      `Langues : ${profile.langues.length ? profile.langues.join(', ') : '—'}`,
      ``,
      `Statut CRS : ${crsLabels[profile.statut_crs] || '—'}`,
      `Projet : ${statutLabels[profile.statut] || '—'}`,
      `Zone cible : ${zoneLabels[profile.zone_cible] || profile.zone_cible || '—'}`,
      `Disponibilité : ${profile.disponibilite || '—'}`,
      `Situation : ${profile.situation_familiale || '—'}`,
      ``,
      `Contact : ${profile.email || '—'} | ${profile.telephone || '—'}`,
      `Localisation actuelle : ${profile.ville_actuelle || '—'}`,
      `Score CV : ${profile.cv_score ? profile.cv_score + '/100' : '—'}`,
      ``,
      `Derniers postes :`,
      ...(profile.employeurs.length
        ? profile.employeurs.slice(0, 3).map(e =>
            `  • ${e.poste || '—'} — ${e.nom || '—'}${e.service ? ' (' + e.service + ')' : ''} — ${e.debut || '?'} → ${e.fin || '?'}`)
        : ['  Aucun poste extrait']),
      ``,
      `Généré le ${new Date().toLocaleDateString('fr-FR')} — suisse-carriere.com`,
    ].join('\n');

    console.log('✅ Profil fusionné :', profile.nom, '|', profile.metier, '|', profile.zone_cible);

    res.json({
      success: true,
      profile: profile,
      ficheAgence: ficheAgence,
    });
  } catch (error) {
    console.error('❌ Erreur merge profil:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SERVEUR
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend Suisse Carrière v2 prêt sur port ${PORT}`));

// ═══════════════════════════════════════════════════════════════
// FONCTION DESIGN RAPPORT HTML
// ═══════════════════════════════════════════════════════════════
function generateReportHtml(data) {
  const color = data.score >= 70 ? '#10b981' : data.score >= 40 ? '#f59e0b' : '#ef4444';
  const redFlags = data.missing_keywords || ['Aucun point bloquant majeur détecté.'];
  const greenPoints = data.recommendations || ['Profil globalement intéressant.'];

  return `
    <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 700px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);">
      <div style="background: #0f172a; color: white; padding: 40px; text-align: center;">
        <h2 style="margin:0; font-weight: 800; letter-spacing: -0.5px; font-size: 24px;">Audit de Conformité Suisse 🇨🇭</h2>
        <p style="margin:5px 0 0 0; opacity:0.8; font-size:14px; text-transform:uppercase; letter-spacing:1px;">Profil détecté : ${data.detected_profile || 'Non spécifié'}</p>
      </div>
      <div style="padding: 40px;">
        <div style="text-align: center; margin-bottom: 40px; padding-bottom: 30px; border-bottom: 1px solid #f1f5f9;">
          <div style="font-size: 72px; font-weight: 900; color: ${color}; line-height: 1; letter-spacing: -2px;">
            ${data.score}<span style="font-size: 30px; color: #cbd5e1; font-weight: 600;">/100</span>
          </div>
          <div style="text-transform: uppercase; font-size: 12px; color: #64748b; margin-top: 15px; font-weight: 700; letter-spacing: 1px;">Score de Compatibilité</div>
        </div>
        <div style="background: #f8fafc; padding: 25px; border-left: 4px solid #0f172a; margin-bottom: 40px; border-radius: 0 8px 8px 0;">
          <strong style="color:#0f172a; display:block; margin-bottom:8px; font-size:14px; text-transform:uppercase;">Verdict de l'IA</strong>
          <span style="line-height: 1.6; color: #334155;">${data.summary}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
          <div>
            <h3 style="color: #ef4444; border-bottom: 2px solid #fee2e2; padding-bottom: 10px; font-size: 16px; margin-top:0;">🚩 Points Bloquants</h3>
            <ul style="padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.6;">
              ${redFlags.map((k) => `<li style="margin-bottom: 6px;">${k}</li>`).join('')}
            </ul>
          </div>
          <div>
            <h3 style="color: #10b981; border-bottom: 2px solid #dcfce7; padding-bottom: 10px; font-size: 16px; margin-top:0;">✅ Points Forts</h3>
            <ul style="padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.6;">
              ${greenPoints.map((r) => `<li style="margin-bottom: 6px;">${r}</li>`).join('')}
            </ul>
          </div>
        </div>
        <div style="margin-top: 50px; text-align: center; background: #fff0f3; padding: 30px; border-radius: 8px; border: 1px solid #ffc9d6;">
          <h3 style="color: #be123c; margin-top: 0; font-size: 20px;">Ne laissez pas l'ATS rejeter ce CV.</h3>
          <p style="margin-bottom: 25px; color: #555; font-size: 14px; line-height: 1.5;">
            Votre profil a du potentiel mais ne respecte pas les codes suisses. Obtenez les outils pour corriger ça.
          </p>
          <a href="https://suisse-carriere.com" target="_blank"
             style="background: #d90429; color: white; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: bold; display: inline-block; transition: background 0.2s; box-shadow: 0 4px 6px rgba(217, 4, 41, 0.2);">
             👉 Voir les Packs de correction
          </a>
        </div>
        <div style="margin-top: 40px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px;">
          Généré par Suisse Carrière Intelligence v2
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// FICHE PROFIL ADMIN (email envoyé à toi uniquement)
// ═══════════════════════════════════════════════════════════════
function generateAdminFicheHtml(extracted, auditData, candidatEmail) {
  const e = extracted || {};
  const score = auditData.score || 0;
  const scoreColor = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';

  const metierLabels = {
    AS: 'Aide-Soignant(e)', IDE: 'Infirmier(e) DE', IADE: 'IADE', IBODE: 'IBODE',
    SF: 'Sage-Femme', TECH: 'Technicien(ne)', CADRE_SANTE: 'Cadre de Santé',
    EXECUTIVE: 'Executive', AUTRE: 'Autre'
  };

  const crsDisplay = e.statut_crs === 'obtenue'
    ? '<span style="color:#10b981;font-weight:700;">✅ Obtenue</span>'
    : e.statut_crs === 'en_cours'
    ? '<span style="color:#f59e0b;font-weight:700;">⏳ En cours</span>'
    : '<span style="color:#ef4444;font-weight:700;">❌ Non mentionnée</span>';

  const employeursHtml = (e.employeurs && e.employeurs.length)
    ? e.employeurs.map(emp =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${emp.poste || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${emp.nom || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${emp.service || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${emp.debut || '?'} → ${emp.fin || '?'}</td>
        </tr>`
      ).join('')
    : '<tr><td colspan="4" style="padding:8px 12px;color:#94a3b8;font-size:13px;">Aucun poste extrait</td></tr>';

  return `
    <div style="font-family:'Inter',Helvetica,sans-serif;max-width:700px;margin:0 auto;background:white;">
      <!-- EN-TÊTE -->
      <div style="background:#0f172a;color:white;padding:30px;text-align:center;">
        <h1 style="margin:0;font-size:20px;font-weight:800;">🆕 Nouveau Profil Extrait</h1>
        <p style="margin:8px 0 0;opacity:0.7;font-size:13px;">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </div>

      <div style="padding:30px;">
        <!-- SCORE + IDENTITÉ -->
        <div style="display:flex;gap:24px;margin-bottom:30px;align-items:center;">
          <div style="text-align:center;flex-shrink:0;">
            <div style="font-size:48px;font-weight:900;color:${scoreColor};line-height:1;">${score}</div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">/100</div>
          </div>
          <div style="flex:1;">
            <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;">${e.nom || 'Nom inconnu'}</div>
            <div style="font-size:15px;color:#475569;margin-bottom:8px;">${metierLabels[e.metier] || e.metier || '—'} — ${e.experience_annees ? e.experience_annees + ' ans d\'exp.' : 'Exp. inconnue'}</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              ${e.email ? `<span style="font-size:12px;background:#f1f5f9;padding:4px 10px;border-radius:4px;">📧 ${e.email}</span>` : ''}
              ${e.telephone ? `<span style="font-size:12px;background:#f1f5f9;padding:4px 10px;border-radius:4px;">📱 ${e.telephone}</span>` : ''}
              ${e.ville_actuelle ? `<span style="font-size:12px;background:#f1f5f9;padding:4px 10px;border-radius:4px;">📍 ${e.ville_actuelle}${e.departement ? ' (' + e.departement + ')' : ''}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- INFOS CLÉS -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;background:#f8fafc;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;width:40%;border-bottom:1px solid #e2e8f0;">Diplôme</td>
            <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;">${e.diplome_principal || '—'}${e.annee_diplome ? ' (' + e.annee_diplome + ')' : ''}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Reconnaissance CRS</td>
            <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;">${crsDisplay}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Spécialités</td>
            <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;">${e.specialites && e.specialites.length ? e.specialites.join(', ') : '—'}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Services</td>
            <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;">${e.services && e.services.length ? e.services.join(', ') : '—'}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Langues</td>
            <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;">${e.langues && e.langues.length ? e.langues.join(', ') : '—'}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Formations comp.</td>
            <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;">${e.formations_complementaires && e.formations_complementaires.length ? e.formations_complementaires.join(', ') : '—'}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Disponibilité</td>
            <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;">${e.disponibilite || '—'}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#64748b;">Qualité CV</td>
            <td style="padding:12px 16px;font-size:13px;">Photo: ${e.a_photo ? '✅' : '❌'} | Réf: ${e.references_mentionnees ? '✅' : '❌'} | ~${e.nombre_pages_estime || '?'} page(s)</td>
          </tr>
        </table>

        <!-- PARCOURS -->
        <h3 style="font-size:14px;font-weight:800;color:#0f172a;text-transform:uppercase;margin-bottom:12px;">📋 Parcours professionnel</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">Poste</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">Établissement</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">Service</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">Période</th>
            </tr>
          </thead>
          <tbody>${employeursHtml}</tbody>
        </table>

        <!-- VERDICT IA -->
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px;">
          <div style="font-weight:700;font-size:13px;color:#92400e;margin-bottom:6px;">🤖 Verdict IA</div>
          <p style="font-size:13px;color:#78350f;margin:0;line-height:1.5;">${auditData.summary || '—'}</p>
        </div>

        <!-- RED FLAGS / GREEN -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
          <div>
            <div style="font-weight:700;font-size:12px;color:#ef4444;margin-bottom:8px;">🚩 RED FLAGS</div>
            <ul style="margin:0;padding-left:16px;font-size:12px;color:#475569;line-height:1.8;">
              ${(auditData.missing_keywords || []).map(k => `<li>${k}</li>`).join('')}
            </ul>
          </div>
          <div>
            <div style="font-weight:700;font-size:12px;color:#10b981;margin-bottom:8px;">✅ POINTS FORTS</div>
            <ul style="margin:0;padding-left:16px;font-size:12px;color:#475569;line-height:1.8;">
              ${(auditData.recommendations || []).map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        </div>

        <!-- ACTIONS -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-weight:700;font-size:13px;color:#14532d;margin-bottom:8px;">⚡ Actions rapides</div>
          ${candidatEmail ? `<a href="mailto:${candidatEmail}" style="display:inline-block;background:#0f172a;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;margin:4px;">📧 Contacter le candidat</a>` : ''}
          ${e.telephone ? `<a href="tel:${e.telephone}" style="display:inline-block;background:#0f172a;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;margin:4px;">📱 Appeler</a>` : ''}
        </div>

        <!-- FOOTER -->
        <div style="margin-top:24px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:16px;">
          Suisse Carrière Intelligence v2 — Email réservé admin
        </div>
      </div>
    </div>
  `;
}
