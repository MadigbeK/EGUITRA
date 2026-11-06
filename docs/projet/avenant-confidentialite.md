# Avenant n° 1 à l'accord de confidentialité réciproque

Lecture des business plans par intelligence artificielle, WhatsApp et prestataires techniques.

**Projet du 6 novembre 2026, à relire par le gérant avant envoi. Les crochets restent à compléter.**

## Parties

Entre E-volution Experience, exerçant sous le nom commercial E-VOLUTION XP, représentée par
M. Madigbè KOUYATÉ, Gérant (« le Prestataire »),

et EGUITRA GROUP SARLU, représentée par M. Mohamed NIMAGA, Directeur Général, et MB AxisPro Consulting,
représentée par [nom et qualité du signataire] (ensemble « le Client »).

## Article 1. Objet

L'article 5.1 de l'accord de confidentialité réciproque (« l'Accord ») limite le traitement des
informations du Client au serveur de la plateforme et à l'espace de sauvegarde hors site, situés dans
l'Union européenne ou au Royaume-Uni.

Deux fonctions de la plateforme sortent de ce périmètre : la lecture des business plans par
intelligence artificielle et les échanges par WhatsApp. Elles restent inactives tant que le présent
avenant n'est pas signé. Conformément à l'article 12.2 de l'Accord, le présent avenant les autorise
aux conditions ci-dessous.

## Article 2. Lecture des business plans par intelligence artificielle

2.1 Fonction. À l'ouverture d'un dossier d'AxisPro Suite, un membre du cabinet peut faire lire le
business plan du promoteur (PDF, Word ou texte, 20 Mo au plus) pour préremplir la fiche du dossier.
Chaque champ prérempli reste à vérifier par le consultant. Rien n'est créé sans sa validation. La
fonction est facultative : sans elle, la fiche se saisit à la main.

2.2 Destinataire. Le document est transmis en entier à Anthropic, aux États-Unis, par son interface
de programmation.

2.3 Garanties. D'après la documentation d'Anthropic consultée le 6 novembre 2026 : le contenu transmis
par cette interface n'est pas utilisé pour entraîner ses modèles sans autorisation expresse ; il est
conservé 30 jours au plus, sauf obligation légale ou contenu signalé comme contraire à ses conditions
d'utilisation (jusqu'à deux ans). La plateforme ne note que le modèle et le nombre de jetons, jamais le
contenu du document.

2.4 Accord du promoteur. Le cabinet ne soumet un business plan qu'après l'accord écrit de son
promoteur (modèle en annexe), et conserve cet accord au dossier.

2.5 Coût. La clé d'accès est portée par [le Client / le Prestataire]. Chaque lecture est facturée à
l'usage par Anthropic ; ce coût est supporté par [le Client / le Prestataire].

## Article 3. WhatsApp

3.1 Fonction. Le service client des deux sociétés peut recevoir et envoyer des messages WhatsApp, par
l'API Cloud de Meta, sur un numéro dédié à chaque société et un compte Meta Business vérifié au nom de
la société concernée.

3.2 Destinataire. Les messages passent par Meta. D'après sa documentation consultée le 6 novembre
2026 : les messages sont chiffrés en transit et au repos, mais les clés sont gérées par Meta pour le
compte de l'entreprise ; ils sont déchiffrés par l'API Cloud avant leur remise à la plateforme, et
conservés 30 jours au plus, principalement pour permettre leur retransmission.

3.3 Stockage local. Le Prestataire demande le stockage local en Allemagne à l'enregistrement de
chaque numéro, si Meta le propose pour ce numéro. Ce réglage ne se change ensuite qu'en réenregistrant
le numéro.

3.4 Usage. WhatsApp sert aux demandes et réclamations des clients. Les dossiers des porteurs de
projets n'y transitent pas, sauf initiative du cabinet dans une relance qu'il envoie lui-même.

## Article 4. Prestataires techniques

Au titre de l'article 5.2 de l'Accord, le Prestataire notifie au Client les prestataires suivants.

| Prestataire | Service | Ce qui y passe |
|---|---|---|
| OVHcloud (France) | Serveur de la plateforme, nom de domaine, boîte d'envoi des courriels | Toutes les données de la plateforme ; le contenu des courriels envoyés par la plateforme |
| Backblaze (région Union européenne) | Espace de sauvegarde hors site | Copies des sauvegardes, chiffrées sur le serveur avant leur envoi ; Backblaze n'en détient pas les clés |
| Expo (États-Unis) | Construction de l'application mobile | Code source de l'application, aucune donnée du Client |
| ntfy.sh et healthchecks.io | Alertes de supervision | État technique du serveur, aucune donnée du Client |

## Article 5. Retrait

Le Client peut retirer à tout moment l'autorisation de l'article 2 ou de l'article 3, par écrit. Le
Prestataire désactive la fonction sous deux jours ouvrés. Plus aucun document ni message n'est alors
transmis ; ceux déjà transmis suivent les durées de conservation indiquées ci-dessus.

## Article 6. Autres dispositions

L'article 4.6 de l'Accord (incident) et l'article 5.3 (aucun usage pour un service destiné à des
tiers) s'appliquent aux traitements autorisés ici. Le Prestataire reste responsable envers le Client,
conformément à l'article 5.2. Les autres stipulations de l'Accord sont inchangées.

Fait à Conakry, le [date], en trois exemplaires originaux.

| Pour E-VOLUTION XP | Pour EGUITRA GROUP SARLU | Pour MB AxisPro Consulting |
|---|---|---|
| M. Madigbè KOUYATÉ, Gérant | M. Mohamed NIMAGA, Directeur Général | [nom et qualité] |
| Signature et cachet : | Signature et cachet : | Signature et cachet : |

<!-- saut de page -->

## Annexe. Modèle d'accord du promoteur

Je soussigné(e) [nom et qualité], représentant [promoteur ou société], autorise MB AxisPro Consulting à
faire lire le business plan de mon projet [nom du projet] par un service d'intelligence artificielle
(Claude, de la société Anthropic, aux États-Unis), afin de préremplir la fiche de mon dossier.

J'ai été informé(e) que :

- le document est transmis en entier à ce service, qui ne l'utilise pas pour entraîner ses modèles et
  le conserve 30 jours au plus, sauf obligation légale ou contenu signalé comme contraire à ses
  conditions d'utilisation (jusqu'à deux ans) ;
- un consultant vérifie chaque information préremplie ;
- je peux refuser : la fiche est alors saisie à la main, sans aucune incidence sur l'examen de mon
  dossier ;
- je peux retirer mon accord par écrit à tout moment pour les lectures à venir.

Fait à [lieu], le [date].

Signature :
