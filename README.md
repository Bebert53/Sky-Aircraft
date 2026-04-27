# Sky Aircraft Visualization (SkyVis)

## Tableau de Bord de Trafic Aérien et Analyse des Retards

## Table des Matières
1.  [Description du Projet](#description-du-projet)
2.  [Fonctionnalités](#fonctionnalités)
3.  [Technologies Utilisées](#technologies-utilisées)
4.  [Structure du Projet](#structure-du-projet)
5.  [Installation et Démarrage](#installation-et-démarrage)
    *   [Prérequis](#prérequis)
    *   [Installation](#installation)
    *   [Démarrage de l'Application](#démarrage-de-lapplication)
6.  [Utilisation](#utilisation)
    *   [Dashboard](#dashboard)
    *   [Vols en temps réel (Scrapping)](#vols-en-temps-réel-scrapping)
    *   [Tableau de bord temps réel](#tableau-de-bord-temps-réel)
    *   [Historique](#historique)
7.  [Points d'API](#points-dapi)
---

## 1. Description du Projet

Sky Aircraft Visualization (SkyVis) est une application web interactive conçue pour visualiser et analyser des données de trafic aérien. Elle fournit un tableau de bord complet affichant des indicateurs clés de performance (KPIs) sur les vols, les retards, la répartition de la flotte aérienne par type ou fabricant, et des analyses historiques. Le projet intègre des outils de visualisation de données (D3.js, Chart.js) pour offrir des aperçus clairs et exploitables sur les tendances du transport aérien. Il inclut également des fonctionnalités de scraping pour la collecte de données en temps réel et un module pour l'importation et le traitement des données brutes.

## 2. Fonctionnalités

*   **Tableau de Bord Global :** Aperçu des KPIs majeurs tels que le nombre moyen de vols par aéroport, le retard moyen, le nombre de passagers et le top 3 des fabricants d'avions.
*   **Visualisation Dynamique de la Répartition de la Flotte :** Un graphique en beignet (Doughnut Chart) affichant la répartition des aéronefs, avec un filtre permettant de voir les Top 5, Top 10, Top 15, ou toutes les catégories.
*   **Analyse des Retards de Vols :** Un nuage de points interactif (Scatter Plot) développé avec D3.js pour comparer la ponctualité et le volume de vols des compagnies aériennes ou des aéroports, filtrable par région.
*   **Graphique de Trafic Aéroportuaire :** Visualisation des volumes de trafic par aéroport.
*   **Données en Temps Réel :** Des capacités de scraping pour collecter et afficher des données de vols en direct.
*   **Historique des Vols :** Une section dédiée à l'exploration des données historiques.
*   **Mise à Jour des Données :** Bouton d'actualisation pour recharger les dernières données disponibles sur le tableau de bord.

## 3. Technologies Utilisées

**Frontend:**
*   **HTML5 / CSS3 :** Structure et style de l'application.
*   **JavaScript (ES6+) :** Logique client, interactions.
*   **D3.js :** Bibliothèque JavaScript pour la manipulation de documents basés sur les données (utilisé pour le nuage de points des retards).
*   **Chart.js :** Bibliothèque JavaScript pour des graphiques simples et flexibles (utilisé pour le graphique en beignet de la flotte).
*   **Font Awesome :** Icônes.
*   **Inter (Police de caractères) :** Typographie moderne et lisible.

**Backend (assumé, basé sur la structure des API):**
*   **Node.js :** Environnement d'exécution JavaScript côté serveur.
*   **Express.js :** Framework web pour construire les APIs RESTful.
*   **SQLite :** Base de données légère utilisée pour stocker les données de trafic aérien (`public/data/traffic.db`).
*   **CSV :** Fichiers de données brutes utilisés pour l'importation.

**Outils de Développement:**
*   **npm / package.json :** Gestionnaire de paquets et définition des dépendances.
*   **Git :** Système de contrôle de version.

## 4. Structure du Projet

```
sky_aircraft_vis/
├───.git/
├───.gitignore
├───database/                   # Contient des scripts liés à la base de données (non directement API)
├───import_aircraft_types.js    # Script pour importer les types d'aéronefs
├───import_delays.js            # Script pour importer les données de retards
├───node_modules/
├───package-lock.json
├───package.json
├───process_aircraft_types.js   # Script pour traiter les types d'aéronefs
├───process_data.js             # Script général de traitement de données
├───README.md                   # Ce fichier
└───public/
    ├───aviation-dashboard.html     # Page principale du tableau de bord
    ├───aviation-historical.html    # Page pour l'historique
    ├───aviation-live-dashboard.html # Page du tableau de bord temps réel
    ├───css/
    │   └───style.css               # Styles CSS globaux
    ├───data/
    │   ├───traffic.db              # Base de données SQLite
    │   └───static/                 # Fichiers CSV de données statiques ou brutes
    │       ├───aircraft_with_assigned_types.csv
    │       ├───aircraftDatabase.csv
    │       ├───airlines_delays_datas.csv
    │       ├───airports_delays_datas.csv
    │       ├───estat_ttr00012_en.csv
    │       ├───traffic_data.csv
    │       └───unknown_sample.csv
    ├───js/
    │   ├───aviation-historical.js  # Script pour la page historique
    │   ├───dashboard-main.js       # Logique principale du tableau de bord, initialisation des widgets
    │   ├───header-fallback.js      # Script de secours pour l'en-tête (si nécessaire)
    │   ├───live-dashboard.js       # Script pour le tableau de bord temps réel
    │   ├───map-live.js             # Logique de la carte en temps réel
    │   ├───shared-socket.js        # Gestion des websockets (pour le temps réel)
    │   ├───charts/
    │   │   ├───aircraftChart.js    # Logique du graphique de répartition de la flotte
    │   │   ├───airportTrafficChart.js # Logique du graphique de trafic aéroportuaire
    │   │   └───flightDelays.js     # Logique du nuage de points des retards de vols
    │   ├───modules/
    │   │   └───kpis.js             # Logique de calcul et affichage des KPIs
    │   └───modules_lives/          # Modules spécifiques au temps réel (à développer)
    └───scrapping/                  # Scripts et données liés au scraping
        ├───air_traffic_logger.js   # Script de logging du trafic aérien
        ├───aircraft_import_result.json
        ├───check_aircraft_db.js
        ├───fill_aircraft_db.js
        ├───fill_airport_traffic.js
        ├───import_aircraft_and_dump.js
        ├───import_aircraft_simple.js
        ├───import_aircraft_stream.js
        ├───index.html              # Page du module de scraping
        ├───package-lock.json
        ├───package.json
        ├───README.txt
        ├───run_import.js           # Script pour lancer l'importation
        ├───server.js               # Serveur Node.js pour le scraping
        ├───verify_import.js        # Script de vérification d'importation
        └───data/                   # Données collectées par le scraping
            └───positions_YYYY-MM-DD_HH-MM.csv
└───scripts/                    # Scripts utilitaires divers
```

## 5. Installation et Démarrage

### Prérequis
Assurez-vous d'avoir installé les éléments suivants :
*   [Node.js](https://nodejs.org/en/) (version 14.x ou supérieure recommandée)
*   [npm](https://www.npmjs.com/) (généralement inclus avec Node.js)

### Installation
1.  **Clonez le dépôt :**
    ```bash
    git clone <URL_DU_DEPOT>
    cd sky_aircraft_vis
    ```
2.  **Installez les dépendances :**
    Naviguez dans le répertoire racine du projet et installez les dépendances npm.
    ```bash
    npm install
    ```
    Si le module de scrapping a ses propres dépendances, naviguez également dans `public/scrapping` et exécutez `npm install` là aussi.
    ```bash
    cd public/scrapping
    npm install
    cd ../../
    ```

### Démarrage de l'Application

Le projet contient un serveur Node.js dans `public/scrapping/server.js` qui semble servir des fichiers statiques et potentiellement des API.

1.  **Lancez le serveur de scrapping (si nécessaire pour les données en temps réel) :**
    ```bash
    cd public/scrapping
    node server.js
    ```
    *Note : Ce serveur pourrait également servir les API mentionnées.*

2.  **Ouvrez le tableau de bord :**
    Une fois le serveur lancé, ouvrez votre navigateur web et accédez à :
    *   `http://localhost:<PORT>/aviation-dashboard.html` (remplacez `<PORT>` par le port sur lequel votre serveur Node.js écoute, souvent 3000 ou 8080).
    *   Si un serveur n'est pas explicitement lancé pour les fichiers du dossier `public`, vous devrez peut-être ouvrir `public/aviation-dashboard.html` directement dans votre navigateur. Cependant, les appels API `fetch` ne fonctionneront pas sans un serveur.

## 6. Utilisation

### Dashboard
Accédez à `aviation-dashboard.html` pour voir un aperçu des KPIs et des graphiques d'analyse.
*   **Filtre Top N (Répartition Flotte) :** Utilisez le sélecteur pour afficher les Top 5, 10, 15 ou tous les types d'aéronefs par volume.
*   **Bouton "Voir Aéroports" / "Voir Compagnies" (Retards) :** Bascule l'affichage du nuage de points entre les données des compagnies aériennes et celles des aéroports.
*   **Sélecteur de Région (Retards) :** Filtrez les données des retards par région géographique.
*   **Bouton "Actualiser" :** Recharge toutes les données affichées sur le tableau de bord.

### Vols en temps réel (Scrapping)
Accédez à `public/scrapping/index.html` ou utilisez les scripts du dossier `public/scrapping` (ex: `air_traffic_logger.js`, `run_import.js`) pour collecter des données de trafic aérien en direct.

### Tableau de bord temps réel
Accédez à `aviation-live-dashboard.html` pour une visualisation en temps réel (nécessite le bon fonctionnement du module de scraping et des websockets).

### Historique
Accédez à `aviation-historical.html` pour explorer les données historiques des vols.

## 7. Points d'API

Le frontend interagit avec les points d'API suivants :

*   **`/api/kpis` :** Récupère les données générales pour les KPIs (tendances, passagers, etc.).
*   **`/api/delays/airports` :** Récupère les données de retards spécifiques aux aéroports.
*   **`/api/delays/airlines` :** Récupère les données de retards spécifiques aux compagnies aériennes.
*   **`/api/aircraft` :** Récupère les données sur la répartition des aéronefs.
    *   **Note sur le filtrage :** Actuellement, ce point d'API n'accepte pas de paramètres de requête pour le filtrage `topN` ou par fabricant. Le filtrage est effectué côté client. Pour des jeux de données plus importants, il serait recommandé d'implémenter le filtrage côté serveur pour des raisons de performance.
*   **`/api/airport-traffic` :** Récupère les données de trafic pour le graphique des aéroports.