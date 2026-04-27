/**
 * @file shared-socket.js
 * Ce script est un SharedWorker qui a pour rôle de maintenir une UNIQUE connexion
 * WebSocket (via socket.io) pour l'ensemble des onglets de l'application ouverts.
 *
 * Avantages :
 * - Économise les ressources en n'ouvrant pas une connexion par onglet.
 * - Assure une synchronisation des données temps réel entre les onglets.
 *
 * Fonctionnement :
 * 1. Il attend que des pages (clients) se connectent à lui.
 * 2. À la première connexion, il initialise la connexion socket.io vers le serveur.
 * 3. Il écoute les événements du socket ('connect', 'disconnect', 'data:batch').
 * 4. Lorsqu'il reçoit des données, il les diffuse (broadcast) à toutes les pages connectées.
 * 5. Il gère la déconnexion des pages et peut potentiellement se fermer si plus aucune page n'est connectée.
 */

// Liste des ports de communication, chaque port représente un onglet connecté.
const ports = [];
let socket = null; // L'instance unique du socket.
let lastBatch = null; // Garde en mémoire le dernier lot complet de données reçu.

/**
 * Diffuse un message à tous les onglets (ports) connectés.
 * @param {Object} msg - Le message à envoyer.
 */
function broadcast(msg) {
    try {
        ports.forEach(p => p.postMessage(msg));
    } catch (e) {
        console.error("Erreur de diffusion du SharedWorker:", e);
    }
}

/**
 * Initialise la connexion socket.io si elle n'est pas déjà active.
 */
function startSocket() {
    if (socket) return;

    try {
        // Importe le client socket.io. Nécessaire car les workers n'ont pas accès au DOM.
        importScripts('https://cdn.socket.io/4.6.1/socket.io.min.js');
    } catch (e) {
        broadcast({ type: 'error', message: 'Impossible de charger le client socket.io dans le SharedWorker.' });
        return;
    }

    try {
        socket = io('http://localhost:8000', { transports: ['websocket', 'polling'] });

        // Relaye les événements du socket à tous les onglets.
        socket.on('connect', () => broadcast({ type: 'connect' }));
        socket.on('disconnect', () => broadcast({ type: 'disconnect' }));
        socket.on('error', (err) => broadcast({ type: 'error', message: String(err) }));
        
        // Événement principal : réception d'un lot de données.
        socket.on('data:batch', (payload) => {
            if (payload) {
                lastBatch = payload; // Met en cache le dernier lot.
                broadcast({ type: 'data:batch', payload: payload });
            }
        });

    } catch (e) {
        broadcast({ type: 'error', message: 'Impossible d\'établir la connexion dans le SharedWorker.' });
    }
}

/**
 * Arrête la connexion socket.io.
 */
function stopSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
        broadcast({ type: 'disconnect' });
    }
}

/**
 * Gestionnaire d'événement principal du worker. S'exécute chaque fois qu'un nouvel
 * onglet se connecte au worker.
 * @param {MessageEvent} e - L'événement de connexion.
 */
onconnect = function(e) {
    const port = e.ports[0];
    ports.push(port);

    // Gère les messages reçus depuis un onglet.
    port.onmessage = function(ev) {
        const data = ev.data || {};
        switch (data.cmd) {
            case 'start':
                startSocket();
                break;
            case 'stop':
                // Note : un 'stop' d'un onglet pourrait déconnecter les autres.
                // À utiliser avec prudence.
                stopSocket();
                break;
        }
    };

    // Démarre le port et notifie la page de la connexion réussie.
    port.start();
    port.postMessage({ type: 'worker:connected' });

    // Si on a déjà des données en cache, on les envoie immédiatement à la nouvelle page.
    if (lastBatch) {
        port.postMessage({ type: 'data:batch', payload: lastBatch });
    }

    // Gère la déconnexion d'un onglet.
    port.onclose = () => {
        const index = ports.indexOf(port);
        if (index > -1) {
            ports.splice(index, 1);
        }
        // Optionnel: si plus aucun onglet n'est connecté, on peut arrêter le socket
        // pour libérer des ressources.
        // if (ports.length === 0) {
        //     stopSocket();
        // }
    };
};
