# Analytics Cup 2.0 — POV joueur (POC)

Prototype d'outil coach pour l'Analytics Cup 2.0 (SkillCorner x PySport) : replay tracking en 3D et 2D, vue POV d'un
joueur reconstruite depuis le Body Pose SkillCorner (29 joints, 25 FPS), mode pause/analyse des passes (options,
adversaire le plus proche, pression), et annotations (flèches) partagées entre les trois vues (3D, 2D, vidéo).

Voir [CLAUDE.md](CLAUDE.md) pour le détail des choix techniques, des pièges de données rencontrés et des pistes non
engagées.

## Prérequis

- [Node.js](https://nodejs.org/) 20+ et npm
- Python 3.12
- [ffmpeg](https://ffmpeg.org/) installé et présent dans le PATH (uniquement pour les scripts vidéo optionnels)

## Installation

```bash
npm install
npm run data   # convertit l'échantillon SkillCorner (data/raw/) en JSON compact (public/data/)
npm run dev    # démarre le serveur de dev sur http://localhost:5173
```

`npm run data` télécharge d'abord les fichiers bruts SkillCorner nécessaires (tracking, Body Pose, Dynamic Events)
s'ils ne sont pas déjà dans `data/raw/` (dossier gitignoré, régénéré à la demande).

## Vidéo du match (optionnelle, hors dépôt)

Le mapping vidéo YouTube du match est dans [`data/match_video_info.csv`](data/match_video_info.csv). **Le règlement
de l'édition 2.0 classe l'usage de vidéo comme donnée supplémentaire (disqualification) : cette fonctionnalité ne
s'active que parce que les organisateurs ont donné leur accord écrit à l'un des participants.** Vérifiez votre propre
autorisation avant de l'activer pour une soumission.

```bash
pip install yt-dlp scipy pillow numpy
npm run video   # télécharge un extrait local (public/video/, gitignoré) + calibre calage et projection caméra
```

Sans cet extrait, l'application fonctionne normalement (la vignette vidéo affiche un message à la place).

## Structure du projet

| Chemin | Contenu |
|---|---|
| `src/` | Vite + TypeScript + Three.js, sans framework |
| `scripts/` | Python : préparation des données et calibration vidéo |
| `public/data/` | Données converties, compactes (committées) |
| `data/raw/`, `public/video/` | Données brutes SkillCorner / extrait vidéo (gitignorés, régénérés par les scripts) |

## Règles de la compétition à respecter

- Uniquement les données SkillCorner open data fournies pour cette édition (pas de données externes).
- Le projet doit tourner "out of the box" pour le jury, hors vidéo (voir ci-dessus).
- Licence open source ([MIT](LICENSE)), README ≤ 1000 mots pour la soumission finale.

## Licence

[MIT](LICENSE)
