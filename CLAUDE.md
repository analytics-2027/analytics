# Analytics Cup 2.0 (SkillCorner x PySport) — POC vue POV joueur

## Objectif
Prototype d'un outil coach : replay tracking + mode pause/analyse, et vue POV d'un joueur reconstruite depuis le Body Pose (29 joints 3D, 25 FPS). Premier jalon : prouver que le POV est exploitable (alignement, couverture, jitter).

## Règles du règlement (non négociables)
- Uniquement les données SkillCorner open data fournies, pas de données externes.
- Vidéo : le règlement écrit 2.0 la classe en donnée supplémentaire (disqualification immédiate). L'utilisateur indique avoir l'autorisation des organisateurs. Extrait local facultatif `public/video/phase406.mp4` (gitignoré, jamais dans le repo), obtenu par `npm run video` (yt-dlp + ffmpeg ; le téléchargement YouTube contrevient à leurs conditions d'utilisation, choix assumé par l'utilisateur) et lu par une balise `<video>` (`src/video.ts`). Le projet doit fonctionner sans l'extrait. Garder la confirmation des organisateurs par écrit et la mentionner dans le README.
- Calage vidéo : le mapping des mi-temps (secondes entières) laisse un décalage résiduel ; `scripts/calibrate_video.py` le mesure en corrélant le mouvement horizontal de la caméra dans la vidéo avec le déplacement de l'emprise `image_corners_projection` (résultat : -1,28 s, corrélation -0,99, stable à ±0,02 s selon les paramètres) et l'écrit dans `syncOffset`. L'horloge d'incrustation de la diffusion n'est pas une référence fiable (secondes entières, décalée de ~3 s).
- yt-dlp : ne pas télécharger les formats DASH avec `--download-sections` (ffmpeg parcourt un flux de 2 h à débit bridé, bloqué plus de 10 min) ; utiliser les formats HLS (232 + 234) et `--js-runtimes node`.
- Doit tourner "out of the box" sans logiciel propriétaire ; licence open source (MIT).
- README <= 1000 mots, 2 figures/tableaux max. Vidéo YouTube d'1 min (hors repo).
- Démo sur l'échantillon commité (`sample_1925299_phase406.jsonl.gz`, 1,8 Mo) ; matchs complets (3,3 Go) = optionnel, streaming obligatoire.

## Stack
- `scripts/` : Python 3.12 (stdlib + pandas/numpy si besoin) -> convertit les données brutes en JSON/binaire compact dans `public/data/`.
- `src/` : Vite + TypeScript + Three.js, sans framework. Le canvas est pensé pour être intégré plus tard dans l'app Svelte existante (2nzi/skillcorner-analytics).
- Données brutes dans `data/raw/` (gitignoré).

## Données Body Pose — pièges connus
- Pose 25 FPS, tracking 10 FPS : `pose_frame = 2.5 * tracking_frame`.
- z relatif au centroïde du joueur, pas au terrain -> hauteur d'yeux fixe (~1.70 m), joints surtout pour le yaw.
- `joints` peut être `null` ; ~1/3 des player-frames seulement ont des joints. Ne jamais inventer une orientation : masquer le POV.
- Vérifier que les joints sont dans le même référentiel XY que le tracking (midHip vs x/y).
- Le fichier contient aussi les joueurs remplacés / pas encore entrés (positions extrapolées, dans les limites du terrain) : filtrer sur `start_time`/`end_time` du match.json (fait dans `prepare_pose.py`).

## Conventions
- Réponses concises, en français. Pas de commentaires superflus dans le code.
- Ne jamais `git push`. Commits locaux uniquement sur demande.

## Idées en attente (pas encore engagées)
- Simulation contrefactuelle : déplacer un joueur en mode pause et recalculer l'impact. Les modèles SkillCorner (xthreat, xpass, EPV) ne sont pas appelables, seulement précalculés aux événements : version réaliste = métriques géométriques recalculées en direct (adversaire le plus proche, couloir de passe bloqué, dans/hors champ, contrôle d'espace), sans probabilités.
- Projection sol -> vidéo (flèches, superposition) : `scripts/calibrate_camera.py` (lancé par `npm run video` / `npm run calibrate`) écrit `public/video/camera406.json`, une homographie par frame (`projectorFromH`, indexée par le temps vidéo courant), avec repli sur celle des 4 coins (`projectorFromCorners`) sans ce fichier. Méthode : les 2 coins du bas de `image_corners_projection` sont exacts et ceux du haut sont sur les bons bords mais plafonnés à y = 39 m ; il reste 2 inconnues par frame (jusqu'où montent les bords vers l'horizon, paramètre sigma = 1/distance), ajustées sur les lignes blanches détectées dans l'image (pixels clairs et fins entourés d'herbe, carte des distances). Mesuré : 65 % des points de lignes à < 3 px (10e centile 55 %, min 47 %) contre 14-28 % pour un modèle de caméra physique (position fixe, azimut/inclinaison/focale/roulis) qui a été essayé et abandonné (lignes écrasées). Contrôles visuels OK sur les frames 127 et 200 (zoom sur le but, écart ~100 px avant) ; test de bout en bout : flèche tracée sur la ligne médiane de la vidéo -> x ≈ 0 en 2D (< 0,5 m). L'ancien constat « 70 px d'écart » était faussé par le décalage temporel non corrigé (1,28 s).
- Vibration des flèches sur la vidéo : les coins de l'emprise ne sont mis à jour qu'à ~10 Hz (paliers, pas moyen de 2,5 frames), donc la projection sautait (secousse mesurée 30 px/frame²). `calibrate_camera.py` interpole linéairement entre paliers, lisse les coins puis les paramètres sigma (secousse 0,9 px/frame², alignement inchangé), et l'application interpole entre deux matrices voisines.
- Sélection de joueur au clic sur la vue principale (glisser = orbite/dessin, pas de sélection) : 3D = joueur le plus proche à l'écran (`World.pickPlayer`), 2D = distance sur le terrain, vidéo = pieds projetés (`pickVideo`). Les 22 joueurs sont dans la liste (« pas de pose » quand la tête n'est jamais résolue). Décor de stade dans `src/stadium.ts` (gradins texturés, toit, panneaux, projecteurs, drapeaux).
- Caméra TV virtuelle reconstruite depuis les 4 coins `image_corners_projection` (l'emprise elle-même est déjà affichée). Demande un ajustement de pose caméra, focale inconnue.
- Statistiques regard→destinataire sur match complet : le sample ne contient qu'1 passe. Nécessite le pose complet (~600 Mo/match, Hugging Face, `download_match`).
