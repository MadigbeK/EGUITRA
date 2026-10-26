# Terrain : téléphone et tablette

`systeme-terrain.md` est le système de conception de l'application native NIMOVA Terrain (Expo, Android d'abord) : principes de terrain, jetons pour React Native, composants et leurs états, écriture, retours, accessibilité, écarts relevés, et en annexe la correspondance avec les jetons du web.
`maquettes.html` réunit les maquettes cliquables des parcours HSSEQ (conducteur au téléphone, chef de parc et Responsable HSSEQ à la tablette), dans des cadres Android à l'échelle réelle, en plein soleil ou en nuit de cabine ; il s'ouvre tel quel dans un navigateur.
Le code natif part de ces deux fichiers, avec le contrat d'API `docs/design/hsseq-contrat.md` pour les données, les libellés et les états.
`icones/` fournit l'icône d'application, l'icône adaptative Android, l'image de démarrage et le favicon, aux noms de `apps/terrain/app.json`, avec le réglage du démarrage et le script qui les refait.
