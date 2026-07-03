document.addEventListener("DOMContentLoaded", function() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(document.title);

    // Bouton Facebook
    const fb = document.getElementById('share-fb');
    if(fb) fb.addEventListener('click', (e) => { e.preventDefault(); window.open(`https://facebook.com{url}`, '_blank'); });

    // Bouton WhatsApp
    const wa = document.getElementById('share-wa');
    if(wa) wa.addEventListener('click', (e) => { e.preventDefault(); window.open(`https://whatsapp.com{text}%20${url}`, '_blank'); });

    // Bouton LinkedIn
    const li = document.getElementById('share-li');
    if(li) li.addEventListener('click', (e) => { e.preventDefault(); window.open(`https://linkedin.com{url}`, '_blank'); });

    // Bouton X (Twitter)
    const x = document.getElementById('share-x');
    if(x) x.addEventListener('click', (e) => { e.preventDefault(); window.open(`https://x.com{url}&text=${text}`, '_blank'); });
});

