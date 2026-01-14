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

// --- PROMPT IA (CIBLAGE SUISSE ROMANDE 🇫🇷🇨🇭) ---
const SYSTEM_PROMPT = `
Tu es un recruteur expert du marché suisse romand (Genève, Vaud, Neuchâtel, Fribourg, Valais, Jura).
Ton rôle est d'analyser un CV pour le filtrage ATS.

RÈGLE D'OR : RÉPONDS UNIQUEMENT EN FRANÇAIS.

LIMITATION TECHNIQUE :
Tu reçois le texte brut. Tu ne vois PAS les images.
Ne mentionne PAS l'absence de photo sauf si écrit "Pas de photo".

CRITÈRES SUISSES ROMANDS :
1. Permis de travail (B/C/G) ou Nationalité Suisse/UE (Critique).
2. Langues : 
   - Français : Indispensable.
   - Anglais : Souvent demandé.
   - Allemand : C'est un ATOUT (un plus), mais PAS rédhibitoire pour la Suisse Romande. Valorise-le s'il est là, mais ne pénalise pas fortement son absence.
3. Localisation : Compatible avec la Suisse Romande ?

FORMAT JSON ATTENDU :
{
  "score": 65, // NOMBRE ENTIER SUR 100
  "risk_level": "faible/moyen/élevé",
  "summary": "Résumé du profil...",
  "missing_keywords": [
      "Phrase 1 sur ce qu'il manque...", 
      "Phrase 2..."
  ],
  "recommendations": ["Conseil 1...", "Conseil 2..."]
}
`;

// --- FRONTEND (Page de test) ---
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Scanner CV Suisse (Romandie)</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; background: #f8fafc; color: #333; }
          .container { background: white; padding: 50px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; border: 1px solid #eee; }
          h1 { color: #d90429; letter-spacing: -0.5px; margin-bottom: 10px; font-weight: 800; font-size: 32px; }
          input[type=email] { padding: 14px; width: 100%; max-width: 400px; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 15px; font-size: 16px; }
          input[type=file] { margin-top: 10px; font-size: 14px; background: #f1f5f9; padding: 10px; border-radius: 6px; width: 100%; max-width: 400px; }
          button { background: #d90429; color: white; padding: 16px 32px; border: none; cursor: pointer; font-size: 16px; margin-top: 25px; border-radius: 6px; font-weight: 600; width: 100%; max-width: 400px; }
          #result { margin-top: 50px; text-align: left; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🇨🇭 Scanner CV Romandie</h1>
          <form id="uploadForm">
            <input type="email" name="user_email" placeholder="Email du candidat" required />
            <br>
            <input type="file" name="cv_file" accept=".pdf,.docx" required />
            <br>
            <button type="submit">Lancer l'analyse</button>
          </form>
        </div>
        <div id="result"></div>
        <script>
          const form = document.getElementById('uploadForm');
          const resultDiv = document.getElementById('result');
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            resultDiv.innerHTML = "<div style='text-align:center; padding:30px;'>⏳ Analyse en cours...</div>";
            const formData = new FormData(e.target);
            try {
              const res = await fetch('/scan', { method: 'POST', body: formData });
              const htmlContent = await res.text(); 
              resultDiv.innerHTML = htmlContent;
            } catch (err) {
              resultDiv.innerHTML = "<div style='color:red; text-align:center'>Erreur : " + err.message + "</div>";
            }
          });
        </script>
      </body>
    </html>
  `);
});

// --- BACKEND ---
app.post('/scan', upload.single('cv_file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('Fichier manquant');

    // 1. Extraction Texte
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
      return res
        .status(400)
        .send('Format non supporté (PDF ou DOCX uniquement)');
    }

    if (!text || text.length < 20)
      return res.status(400).send('Fichier illisible.');

    // 2. Appel IA
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-001',
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Analyse ce CV (RÉPONDRE EN FRANÇAIS) :\n${text}`,
            },
          ],
          response_format: { type: 'json_object' },
        }),
      }
    );

    const aiJson = await response.json();
    if (aiJson.error)
      throw new Error(
        'Erreur IA: ' + (aiJson.error.message || 'Erreur inconnue')
      );

    const content = JSON.parse(aiJson.choices[0].message.content);
    if (content.score < 1) content.score = Math.round(content.score * 100);

    const htmlReport = generateReportHtml(content);

    // 3. Email (AVEC BCC POUR TOI)
    let emailMessage = '';
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev', // Change ça plus tard par ton vrai domaine
          to: req.body.user_email,
          bcc: 'chaborel@gmail.com', // 👈 TA COPIE CACHÉE ICI !
          subject: `Votre Analyse CV Suisse (${content.score}/100)`,
          html: htmlReport,
        }),
      });

      if (!emailRes.ok) throw new Error('Erreur API Resend');
      emailMessage = `<div style="background:#dcfce7; color:#14532d; padding:12px; border-radius:6px; text-align:center; margin-bottom:30px; border:1px solid #bbf7d0; font-weight:600;">✅ Rapport envoyé à ${req.body.user_email}</div>`;
    } catch (e) {
      // En cas de blocage réseau (StackBlitz/Entreprise)
      emailMessage = `<div style="background:#fff7ed; color:#9a3412; padding:12px; border-radius:6px; text-align:center; margin-bottom:30px; border:1px solid #ffedd5; font-size:13px;">⚠️ Note : Email bloqué par le réseau, mais voici le résultat :</div>`;
    }

    res.send(emailMessage + htmlReport);
  } catch (error) {
    console.error('Erreur Backend:', error);
    res
      .status(500)
      .send(
        `<div style="color:red; text-align:center; padding:20px;">Erreur technique : ${error.message}</div>`
      );
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Prêt`));

// --- FONCTION DESIGN (AVEC CALL TO ACTION) ---
function generateReportHtml(data) {
  const color =
    data.score >= 70 ? '#10b981' : data.score >= 40 ? '#f59e0b' : '#ef4444';

  return `
    <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 700px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);">
      
      <div style="background: #d90429; color: white; padding: 40px; text-align: center;">
        <h2 style="margin:0; font-weight: 800; letter-spacing: -0.5px; font-size: 24px;">Rapport ATS Suisse 🇨🇭</h2>
        <p style="margin:5px 0 0 0; opacity:0.9; font-size:14px;">Spécial Suisse Romande</p>
      </div>
      
      <div style="padding: 40px;">
        <div style="text-align: center; margin-bottom: 40px; padding-bottom: 30px; border-bottom: 1px solid #f1f5f9;">
          <div style="font-size: 72px; font-weight: 900; color: ${color}; line-height: 1; letter-spacing: -2px;">
            ${
              data.score
            }<span style="font-size: 30px; color: #cbd5e1; font-weight: 600;">/100</span>
          </div>
          <div style="text-transform: uppercase; font-size: 12px; color: #64748b; margin-top: 15px; font-weight: 700; letter-spacing: 1px;">Score Global</div>
        </div>

        <div style="background: #f8fafc; padding: 25px; border-left: 4px solid #d90429; margin-bottom: 40px; border-radius: 0 8px 8px 0;">
          <strong style="color:#0f172a; display:block; margin-bottom:8px; font-size:14px; text-transform:uppercase;">En résumé</strong>
          <span style="line-height: 1.6; color: #334155;">${data.summary}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
          <div>
            <h3 style="color: #ef4444; border-bottom: 2px solid #fee2e2; padding-bottom: 10px; font-size: 16px; margin-top:0;">⚠️ À corriger</h3>
            <ul style="padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.6;">
              ${data.missing_keywords
                .map((k) => `<li style="margin-bottom: 6px;">${k}</li>`)
                .join('')}
            </ul>
          </div>
          <div>
            <h3 style="color: #10b981; border-bottom: 2px solid #dcfce7; padding-bottom: 10px; font-size: 16px; margin-top:0;">💡 Conseils</h3>
            <ul style="padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.6;">
              ${data.recommendations
                .map((r) => `<li style="margin-bottom: 6px;">${r}</li>`)
                .join('')}
            </ul>
          </div>
        </div>

        <div style="margin-top: 50px; text-align: center; background: #fff0f3; padding: 30px; border-radius: 8px; border: 1px solid #ffc9d6;">
          <h3 style="color: #d90429; margin-top: 0; font-size: 20px;">Besoin d'aide pour atteindre 100/100 ?</h3>
          <p style="margin-bottom: 25px; color: #555; font-size: 14px; line-height: 1.5;">
            Votre CV a du potentiel. Je peux vous aider à optimiser chaque détail pour décrocher des entretiens en Suisse Romande.
          </p>
          <a href="https://TON-SITE-SHOPIFY.com/products/coaching-cv" 
             style="background: #d90429; color: white; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: bold; display: inline-block; transition: background 0.2s;">
             👉 Réserver un Coaching CV
          </a>
        </div>
        
        <div style="margin-top: 40px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px;">
          Généré par l'IA Ready for Swiss
        </div>
      </div>
    </div>
  `;
}
