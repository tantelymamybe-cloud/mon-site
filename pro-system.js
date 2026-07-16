/* ==========================================================================
   outilsweb-pro — Système PRO (client)
   ==========================================================================
   Ce fichier gère l'AFFICHAGE et les LIMITES côté navigateur, mais la VÉRITÉ
   sur qui est abonné vient exclusivement du Worker Cloudflare (dossier
   /cloudflare-worker). Chaque ticket d'accès PRO est signé par le Worker
   avec une clé ECDSA privée qu'il est seul à connaître. Le navigateur vérifie
   la signature localement avec la clé PUBLIQUE ci-dessous (sans danger à
   exposer) : il est mathématiquement impossible de fabriquer un ticket valide
   depuis la console — contrairement à un simple drapeau localStorage.
   ========================================================================== */

const PRO_CONFIG = {
  price: '4,99 $',
  freeLimitPerDay: 3,                      // utilisations gratuites, par outil, par jour
  revalidateAfterMs: 6 * 60 * 60 * 1000,    // tente un renouvellement du ticket toutes les 6h
  successParam: 'client_ref',                // paramètre lu au retour de Lemon Squeezy

  // Remplacez par l'URL de votre Worker une fois déployé, ex :
  //   'https://outilsweb-pro-api.VOTRE-SOUS-DOMAINE.workers.dev'
  apiBase: 'https://outilsweb-pro-api.tantelymamybe.workers.dev',
};

/* Clé PUBLIQUE ECDSA P-256 — dérivée de la clé privée que seul le Worker
   connaît. La rendre publique ici ne pose AUCUN risque : elle permet de
   VÉRIFIER une signature, jamais d'en produire une nouvelle. */
const PRO_PUBLIC_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'SKbwYDiKgBHk-AqO0cec5k0IoFoFLcBfOatXhfhSjv4',
  y: 'bbj-hKSIaZymsVNt37RrfmhX0p-S6I_4gqJweLvQ658',
  key_ops: ['verify'],
  ext: true,
};

const TOOL_LABELS = {
  pdf: 'Convertisseur PDF',
  pdfc: 'Compresseur PDF',
  pdfms: 'Fusion / Découpage PDF',
  inv: 'Générateur de facture',
  img: "Compresseur d'images",
  qr: 'Générateur QR Code',
  pct: 'Calculateur de pourcentage',
  cur: 'Convertisseur de devises',
  pwd: 'Générateur de mot de passe',
  trn: 'Traducteur',
};

/* ---------------------------------------------------------------------- */
/* Stockage local : usage quotidien (limites gratuites)                   */
/* ---------------------------------------------------------------------- */

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function getUsage() {
  try {
    const raw = localStorage.getItem('owp_pro_usage');
    const data = raw ? JSON.parse(raw) : null;
    if (!data || data.date !== todayStr()) return { date: todayStr(), counts: {} };
    return data;
  } catch (e) {
    return { date: todayStr(), counts: {} };
  }
}
function saveUsage(usage) {
  try { localStorage.setItem('owp_pro_usage', JSON.stringify(usage)); } catch (e) {}
}

/* ---------------------------------------------------------------------- */
/* Ticket PRO : vérification ECDSA locale (aucun réseau requis)           */
/* ---------------------------------------------------------------------- */

let publicKeyPromise = null;
function getPublicKey() {
  if (!publicKeyPromise) {
    publicKeyPromise = crypto.subtle.importKey(
      'jwk', PRO_PUBLIC_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
  }
  return publicKeyPromise;
}
function b64urlToBuf(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function b64urlDecodeStr(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return decodeURIComponent(escape(atob(str)));
}

/** Vérifie la signature ECDSA d'un ticket et son expiration, sans réseau.
 *  Renvoie {customerId, exp} si authentique, sinon null. */
async function verifyTicketLocally(ticket) {
  if (!ticket || !ticket.includes('.')) return null;
  const [payloadB64, sigB64] = ticket.split('.');
  try {
    const key = await getPublicKey();
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key,
      b64urlToBuf(sigB64), new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;
    const data = JSON.parse(b64urlDecodeStr(payloadB64));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// État en mémoire, rafraîchi de façon asynchrone (voir refreshProState).
// isPRO() reste synchrone en ne lisant que ce cache — jamais une valeur
// que l'utilisateur pourrait écrire lui-même sans passer par la vérification.
let proState = { valid: false, exp: 0, customerId: null, lastServerCheckAt: 0 };

/** true si un ticket AUTHENTIQUE et non expiré est en cache mémoire. */
function isPRO() {
  return proState.valid && Math.floor(Date.now() / 1000) < proState.exp;
}

/** Relit le ticket stocké et revérifie sa signature localement (rapide, sans réseau). */
async function refreshProStateFromStorage() {
  const ticket = localStorage.getItem('owp_pro_ticket');
  if (!ticket) { proState = { valid: false, exp: 0, customerId: null, lastServerCheckAt: proState.lastServerCheckAt }; return; }
  const decoded = await verifyTicketLocally(ticket);
  if (decoded) {
    proState = { valid: true, exp: decoded.exp, customerId: decoded.customerId, lastServerCheckAt: proState.lastServerCheckAt };
  } else {
    localStorage.removeItem('owp_pro_ticket'); // signature invalide ou expiré : on nettoie
    proState = { valid: false, exp: 0, customerId: null, lastServerCheckAt: proState.lastServerCheckAt };
  }
}

/* ---------------------------------------------------------------------- */
/* Vérifications côté serveur (Worker) — émission et renouvellement       */
/* ---------------------------------------------------------------------- */

/** Appelé une fois au retour de Lemon Squeezy (?client_ref=...). Le webhook
 *  qui confirme le paiement peut arriver quelques secondes après le retour
 *  du navigateur : on réessaie plusieurs fois avant d'abandonner. */
async function verifyCheckoutSession(clientRef) {
  showProToast('Confirmation du paiement en cours…');

  const maxAttempts = 8;
  const delayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(PRO_CONFIG.apiBase + '/api/verify-session?client_ref=' + encodeURIComponent(clientRef));
      const data = await res.json();

      if (data.valid && data.token) {
        localStorage.setItem('owp_pro_ticket', data.token);
        await refreshProStateFromStorage();
        proState.lastServerCheckAt = Date.now();
        updateProUI();
        showProToast(_tr('🎉 Paiement confirmé — bienvenue en PRO !'));
        return;
      }

      if (!data.pending) {
        // référence inconnue/expirée : inutile de continuer à réessayer
        showProToast(_tr("Le paiement n'a pas pu être confirmé. Contactez-nous si le prélèvement a bien eu lieu."));
        return;
      }
      // sinon : encore en attente du webhook, on retente après une pause
    } catch (e) {
      // erreur réseau ponctuelle : on retente aussi
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  showProToast(_tr("La confirmation prend plus de temps que prévu. Rechargez la page dans une minute — si le paiement a bien été débité, l'accès PRO s'activera automatiquement."));
}

/** Renouvelle silencieusement le ticket en tâche de fond, et détecte les
 *  annulations d'abonnement (le Worker vérifie le statut réel côté Lemon Squeezy). */
async function revalidateLicense() {
  const ticket = localStorage.getItem('owp_pro_ticket');
  if (!ticket) return;
  if ((Date.now() - proState.lastServerCheckAt) < PRO_CONFIG.revalidateAfterMs) return; // pas encore nécessaire

  try {
    const res = await fetch(PRO_CONFIG.apiBase + '/api/check-license?token=' + encodeURIComponent(ticket));
    const data = await res.json();
    if (data.valid && data.token) {
      localStorage.setItem('owp_pro_ticket', data.token); // ticket renouvelé, exp repoussée
    } else if (data.valid === false) {
      localStorage.removeItem('owp_pro_ticket'); // abonnement annulé / impayé : accès coupé
    }
    proState.lastServerCheckAt = Date.now();
    await refreshProStateFromStorage();
  } catch (e) {
    // pas de réseau : on garde le ticket existant, sa signature+expiration
    // (contrôlées cryptographiquement) continuent de faire foi jusqu'à échéance.
  } finally {
    updateProUI();
  }
}

/* ---------------------------------------------------------------------- */
/* Actions déclenchées par l'utilisateur                                  */
/* ---------------------------------------------------------------------- */

/** Redirige vers le checkout Lemon Squeezy (créé par le Worker) */
async function goToProCheckout() {
  const btn = document.querySelector('.pro-cta-btn');
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Redirection vers le paiement…'; }

  try {
    const res = await fetch(PRO_CONFIG.apiBase + '/api/create-checkout', { method: 'POST' });
    const data = await res.json();
    if (!data.url) throw new Error('URL manquante');
    window.location.href = data.url;
  } catch (e) {
    alert(_tr('Impossible de contacter le serveur de paiement pour le moment. Réessayez dans un instant.'));
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

/** Ouvre le portail client Lemon Squeezy (gérer/annuler l'abonnement) */
async function manageSubscription() {
  const ticket = localStorage.getItem('owp_pro_ticket');
  if (!ticket) { openProModal(); return; }

  try {
    const res = await fetch(PRO_CONFIG.apiBase + '/api/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ticket }),
    });
    const data = await res.json();
    if (data.url) { window.location.href = data.url; }
    else { alert(_tr("Impossible d'ouvrir la gestion de l'abonnement pour le moment.")); }
  } catch (e) {
    alert(_tr('Connexion au serveur impossible pour le moment.'));
  }
}

/**
 * À appeler en tout début de chaque fonction d'action d'un outil, ex :
 *   function compressPdf(){
 *     if(!checkPROLimits('pdfc')) return;
 *     ... reste du traitement
 *   }
 */
function checkPROLimits(toolId) {
  if (isPRO()) return true;

  const usage = getUsage();
  const used = usage.counts[toolId] || 0;

  if (used >= PRO_CONFIG.freeLimitPerDay) {
    openProModal(toolId);
    return false;
  }

  usage.counts[toolId] = used + 1;
  saveUsage(usage);
  updateProUI();
  return true;
}

/* ---------------------------------------------------------------------- */
/* Interface : modal, badges, bannières d'usage                           */
/* ---------------------------------------------------------------------- */

function openProModal(toolId) {
  const overlay = document.getElementById('pro-overlay');
  const sub = document.getElementById('pro-modal-sub');
  if (sub) {
    sub.textContent = (toolId && TOOL_LABELS[toolId])
      ? _tr('Vous avez atteint la limite gratuite du jour pour « ') + _tr(TOOL_LABELS[toolId]) + _tr(' ». Passez en PRO pour un usage illimité.')
      : _tr('Débloquez un usage illimité de tous les outils, sans limite quotidienne.');
  }
  if (overlay) { overlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeProModal() {
  const overlay = document.getElementById('pro-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function showProToast(message) {
  let toast = document.getElementById('pro-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pro-toast';
    toast.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);' +
      'background:#121826;color:#F5F7FC;border:1px solid #26304A;padding:13px 20px;' +
      'border-radius:12px;font-size:14.5px;font-family:Inter,sans-serif;z-index:300;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:90vw;text-align:center;opacity:0;transition:opacity .25s;';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 4200);
}

function updateProUI() {
  const pro = isPRO();
  document.querySelectorAll('.pro-badge').forEach((b) => { b.style.display = pro ? 'inline-flex' : 'none'; });
  document.querySelectorAll('.pro-cta-nav').forEach((b) => { b.style.display = pro ? 'none' : 'inline-flex'; });
  document.querySelectorAll('.pro-manage-nav').forEach((b) => { b.style.display = pro ? 'inline-flex' : 'none'; });
  renderUsageBanners();
}

function renderUsageBanners() {
  const pro = isPRO();
  const usage = getUsage();

  document.querySelectorAll('.panel[id^="panel-"]').forEach((panel) => {
    const toolId = panel.id.replace('panel-', '');
    if (!TOOL_LABELS[toolId]) return;

    let banner = panel.querySelector('.pro-usage-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'pro-usage-banner';
      const anchor = panel.querySelector('.panel-sub') || panel.querySelector('.panel-head');
      if (anchor) anchor.insertAdjacentElement('afterend', banner);
      else panel.appendChild(banner);
    }
    banner.classList.remove('limit-reached');

    if (pro) {
      banner.innerHTML = '<span class="pro-chip">✨ PRO</span> ' + _tr('Utilisations illimitées sur cet outil.');
      return;
    }

    const used = usage.counts[toolId] || 0;
    const left = Math.max(0, PRO_CONFIG.freeLimitPerDay - used);

    if (left > 0) {
      const leftText = (typeof currentLang !== 'undefined' && currentLang === 'en')
        ? left + ' free use' + (left > 1 ? 's' : '') + ' left today for this tool · '
        : left + ' utilisation' + (left > 1 ? 's' : '') +
          ' gratuite' + (left > 1 ? 's' : '') + ' restante' + (left > 1 ? 's' : '') +
          " aujourd'hui pour cet outil · ";
      banner.innerHTML = leftText +
        '<a href="javascript:void(0)" onclick="openProModal(\'' + toolId + '\')">' + _tr('Passer en PRO') + '</a>';
    } else {
      banner.classList.add('limit-reached');
      banner.innerHTML = _tr('Limite gratuite du jour atteinte pour cet outil · ') +
        '<a href="javascript:void(0)" onclick="openProModal(\'' + toolId + '\')">' + _tr('Passer en PRO pour continuer') + '</a>';
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Initialisation                                                         */
/* ---------------------------------------------------------------------- */

(function initProSystem() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get(PRO_CONFIG.successParam);

  // On vérifie d'abord le ticket déjà stocké (rapide, purement local),
  // pour que l'interface reflète le bon état dès l'affichage.
  refreshProStateFromStorage().then(updateProUI);

  if (sessionId) {
    // Retour de Lemon Squeezy : nettoie l'URL tout de suite (évite de reverifier en boucle)
    params.delete(PRO_CONFIG.successParam);
    const cleanQuery = params.toString();
    const cleanUrl = window.location.pathname + (cleanQuery ? '?' + cleanQuery : '') + window.location.hash;
    if (window.history && window.history.replaceState) window.history.replaceState(null, '', cleanUrl);

    document.addEventListener('DOMContentLoaded', () => verifyCheckoutSession(sessionId));
  } else {
    document.addEventListener('DOMContentLoaded', () => revalidateLicense()); // silencieux, en tâche de fond
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProModal(); });
})();
