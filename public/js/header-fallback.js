/**
 * @file Ce script injecte un groupe de boutons de navigation dans l'en-tête de la page.
 * Il agit comme un "fallback" (solution de repli) au cas où l'en-tête principal
 * ne serait pas chargé, garantissant que la navigation reste accessible.
 * Le script est auto-exécuté dans une IIFE (Immediately Invoked Function Expression).
 */
(function() {
    try {
        // --- 1. Vérification de l'existence des boutons ---
        // Si un élément avec la classe '.header-buttons' existe déjà, on ne fait rien.
        if (document.querySelector('.header-buttons')) {
            return;
        }

        // --- 2. Détermination de la cible pour l'injection ---
        // On cherche l'en-tête. Si on le trouve, on cible la section '.right' ou l'en-tête lui-même.
        // Sinon, on se rabat sur le `<body>` du document.
        const header = document.querySelector('header');
        const target = header ? (header.querySelector('.right') || header) : document.body;

        if (!target) return; // Si aucune cible n'est trouvée, on arrête.

        // --- 3. Création du conteneur pour les boutons ---
        const wrap = document.createElement('div');
        wrap.className = 'header-buttons';
        wrap.style.marginRight = '12px';

        /**
         * Crée un bouton de navigation (lien `<a>`).
         * @param {string} href - L'URL de destination.
         * @param {string} html - Le contenu HTML du bouton (icône + texte).
         * @returns {HTMLAnchorElement} L'élément `<a>` créé.
         */
        const makeBtn = (href, html) => {
            const a = document.createElement('a');
            a.href = href;
            a.className = 'header-btn';
            a.innerHTML = html;
            return a;
        };

        // --- 4. Création des boutons ---
        const btns = [
            makeBtn('/aviation-dashboard.html', '<i class="fa-solid fa-chart-pie"></i> Vue d\'ensemble'),
            makeBtn('/scrapping/index.html', '<i class="fa-solid fa-plane"></i> Vols en temps réel'),
            makeBtn('/aviation-historical.html', '<i class="fa-solid fa-clock"></i> Historique')
        ];
        
        // Ajoute chaque bouton au conteneur.
        btns.forEach(b => wrap.appendChild(b));

        // --- 5. Marquer le bouton actif ---
        // Détermine la page actuelle à partir de l'URL et ajoute la classe 'active' au bouton correspondant.
        const p = location.pathname || '';
        if (p.includes('aviation-historical')) {
            btns[2].classList.add('active');
        } else if (p.includes('scrapping') || p.includes('live-dashboard')) {
            btns[1].classList.add('active');
        } else {
            btns[0].classList.add('active');
        }

        // --- 6. Injection dans le DOM ---
        // Insère le groupe de boutons au début de l'élément cible.
        target.insertBefore(wrap, target.firstChild);

    } catch (e) {
        console.error('Erreur dans le script de fallback pour l\'en-tête:', e);
    }
})();
