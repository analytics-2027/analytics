# Analytics Cup 2.0 (SkillCorner x PySport) — POC vue POV joueur

## Objectif
Prototype d'un outil coach : replay tracking + mode pause/analyse, et vue POV d'un joueur reconstruite depuis le Body Pose (29 joints 3D, 25 FPS). Premier jalon : prouver que le POV est exploitable (alignement, couverture, jitter).

## Règles du règlement (non négociables)
- Uniquement les données SkillCorner open data fournies. JAMAIS de vidéo ni de données externes (disqualification).
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
- Caméra TV virtuelle reconstruite depuis les 4 coins `image_corners_projection` (l'emprise elle-même est déjà affichée). Demande un ajustement de pose caméra, focale inconnue.
- Statistiques regard→destinataire sur match complet : le sample ne contient qu'1 passe. Nécessite le pose complet (~600 Mo/match, Hugging Face, `download_match`).
