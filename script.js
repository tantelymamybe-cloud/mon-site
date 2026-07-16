/* --- Gestion dynamique des scripts --- */
function loadScript(url, callback) {
    if (document.querySelector(`script[src="${url}"]`)) { callback(); return; }
    const script = document.createElement('script');
    script.src = url;
    script.onload = callback;
    document.head.appendChild(script);
}

/* --- Navigation --- */
function showHome(){
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('home').style.display='block';
    window.scrollTo({top:0,behavior:'smooth'});
}

function openTool(id){
    document.getElementById('home').style.display='none';
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    const panel = document.getElementById('panel-'+id);
    if(panel) panel.classList.add('active');
    
    // Chargement conditionnel des libs lourdes
    if (id === 'pdf' && !window.jspdf) {
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => {});
    }
    window.scrollTo({top:0,behavior:'smooth'});
}

/* --- Thème --- */
function applyTheme(t){
    document.documentElement.setAttribute('data-theme',t);
    localStorage.setItem('theme',t);
    const btn = document.getElementById('theme-toggle');
    if(btn) btn.textContent = t==='light' ? '🌙' : '☀️';
}

function toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme')||'dark';
    applyTheme(cur==='dark'?'light':'dark');
}

/* --- Initialisation --- */
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(localStorage.getItem('theme')||'dark');
    // Appelle tes autres fonctions d'init ici (fillCur, etc.)
});
