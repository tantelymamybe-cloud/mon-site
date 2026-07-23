/* ==========================================================================
   outilsweb-pro — Service Worker
   --------------------------------------------------------------------------
   STRATÉGIE : « réseau d'abord » pour les fichiers du site.

   L'ancienne version utilisait « cache d'abord » : une fois un fichier mis en
   cache (i18n.js, une page HTML…), le navigateur servait indéfiniment cette
   copie, même après un nouveau déploiement. Les mises à jour n'arrivaient
   donc jamais chez les visiteurs déjà venus — y compris après un Ctrl+F5,
   puisque le service worker intercepte la requête avant le réseau.

   Désormais : on tente le réseau en premier (donc toujours la dernière
   version), et on ne retombe sur le cache qu'en cas de coupure de connexion.
   Le site reste utilisable hors ligne, mais n'est plus jamais figé.

   ⚠️ À CHAQUE DÉPLOIEMENT IMPORTANT : incrémentez CACHE_NAME (v2 -> v3…).
      Cela supprime l'ancien cache et garantit une remise à zéro propre.
   ========================================================================== */

const CACHE_NAME = 'outilsweb-pro-v2';

const APP_SHELL = [
  '/',
  '/index.html',
  '/about.html',
  '/contact.html',
  '/guides.html',
  '/privacy.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Les CDN et les API externes ne passent pas par le service worker.
  if (url.origin !== self.location.origin) return;
  // On ne met en cache que les requêtes GET.
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        // Réponse valide : on rafraîchit la copie en cache pour le hors-ligne.
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        // Hors ligne : on sert la dernière copie connue.
        caches.match(req).then((cached) => cached || caches.match('/index.html'))
      )
  );
});
