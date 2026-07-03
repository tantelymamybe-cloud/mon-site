// Script de partage simplifié pour vos boutons
document.addEventListener("DOMContentLoaded", function() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(document.title);

    // Configurer le clic pour chaque bouton
    const fb = document.querySelector('.a2a_button_facebook');
    if(fb) fb.addEventListener('click', () => window.open(`https://facebook.com{url}`, '_blank'));

    const wa = document.querySelector('.a2a_button_whatsapp');
    if(wa) wa.addEventListener('click', () => window.open(`https://whatsapp.com{text}%20${url}`, '_blank'));

    const li = document.querySelector('.a2a_button_linkedin');
    if(li) li.addEventListener('click', () => window.open(`https://linkedin.com{url}`, '_blank'));

    const x = document.querySelector('.a2a_button_x');
    if(x) x.addEventListener('click', () => window.open(`https://x.com{url}&text=${text}`, '_blank'));
});
