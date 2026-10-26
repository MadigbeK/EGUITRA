"""Tests de refus par profil : un compte de chaque profil, connecté à une application que ce profil
ouvre, appelle une route d'écriture qui ne lui est pas ouverte et reçoit 403.

À combiner avec ApiCase (common.py) : class TestX(RefusParProfil, ApiCase).
"""

# Application où chaque profil se connecte (organisation.APPS). Les profils du cabinet et le porteur
# exigent la société MB AxisPro Consulting (organisation.PROFILE_ENTITY) ; les autres travaillent dans
# la société principale, celle des données des tests.
APPLICATION = {
    "admin": "finance",
    "direction": "finance",
    "finance": "finance",
    "achats": "finance",
    "exploitation": "finance",
    "chantiers": "finance",
    "immobilier": "finance",
    "cabinet": "axispro",
    "porteur": "portail",
    "rh": "rh",
}
PROFILS = tuple(APPLICATION)
DU_CABINET = ("cabinet", "porteur")


class RefusParProfil:
    """Comptes et sessions des profils refusés par une route, créés au besoin et gardés le temps du test
    (une session par compte : la double authentification n'est activée qu'une fois)."""

    def jetons_hors(self, autorises, prefixe="refus"):
        """Jeton de session d'un compte de chaque profil absent de `autorises` (profils de la route).
        Le profil RH n'est essayé que si son application existe (module eguitra_rh installé)."""
        sessions = self.__dict__.setdefault("_sessions_refus", {})
        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        jetons = {}
        for profil in PROFILS:
            if profil in autorises or (profil == "rh" and "eguitra.rh.employee" not in self.env):
                continue
            login = f"{prefixe}.{profil}"
            if login not in sessions:
                if not self.env["res.users"].with_context(active_test=False).search_count([("login", "=", login)]):
                    societe = {"company_id": cabinet.id, "company_ids": [(6, 0, cabinet.ids)]} if profil in DU_CABINET else {}
                    self._create_user(login, profil, **societe)
                sessions[login] = self.open_session(login, app=APPLICATION[profil])["access_token"]
            jetons[profil] = sessions[login]
        return jetons

    def assertRefuseHors(self, autorises, method, path, payload=None, prefixe="refus"):
        """Chaque profil absent de `autorises` reçoit 403 sur la route, sans que rien ne change."""
        jetons = self.jetons_hors(autorises, prefixe)
        self.assertTrue(jetons, "Aucun profil à refuser : vérifier les profils de la route")
        for profil, jeton in jetons.items():
            with self.subTest(route=f"{method} {path}", profil=profil):
                status, body = self.call(method, path, payload, token=jeton)
                self.assertEqual(status, 403, (profil, body))
