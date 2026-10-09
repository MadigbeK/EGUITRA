-- Schéma minimal imitant les tables Odoo 18 lues par l'API (tests d'intégration sans noyau).
-- Ne reproduit que les colonnes utilisées par app/reports/registry.py et app/routers/finance.py.
DROP TABLE IF EXISTS account_move_line, account_move, account_account, account_journal, res_partner CASCADE;
CREATE TABLE res_partner (id serial PRIMARY KEY, name varchar, city varchar);
CREATE TABLE account_journal (id serial PRIMARY KEY, name jsonb, code varchar, type varchar);
CREATE TABLE account_account (id serial PRIMARY KEY, code_store jsonb, name jsonb, account_type varchar);
CREATE TABLE account_move (
  id serial PRIMARY KEY, name varchar, ref varchar, state varchar, move_type varchar, journal_id int REFERENCES account_journal(id),
  partner_id int REFERENCES res_partner(id), date date, invoice_date date, invoice_date_due date, payment_state varchar,
  amount_untaxed_signed numeric, amount_total_signed numeric, amount_residual_signed numeric
);
CREATE TABLE account_move_line (
  id serial PRIMARY KEY, move_id int REFERENCES account_move(id), account_id int REFERENCES account_account(id),
  journal_id int REFERENCES account_journal(id), partner_id int REFERENCES res_partner(id), date date, name varchar,
  display_type varchar, debit numeric DEFAULT 0, credit numeric DEFAULT 0, balance numeric DEFAULT 0
);
INSERT INTO res_partner (name, city) VALUES ('TOTALENERGIES MARKETING GUINEE','Conakry'), ('SIMFER SA','Beyla'), ('STATION SHELL KALOUM','Conakry');
INSERT INTO account_journal (name, code, type) VALUES ('{"fr_FR":"Ventes"}','VEN','sale'), ('{"fr_FR":"Achats"}','ACH','purchase'), ('{"fr_FR":"BICIGUI"}','BQ1','bank'), ('{"fr_FR":"Caisse"}','CA1','cash');
INSERT INTO account_account (code_store, name, account_type) VALUES
 ('{"1":"411000"}','{"fr_FR":"Clients"}','asset_receivable'), ('{"1":"401100"}','{"fr_FR":"Fournisseurs"}','liability_payable'),
 ('{"1":"706100"}','{"fr_FR":"Services vendus - Transport"}','income'), ('{"1":"605310"}','{"fr_FR":"Carburant"}','expense'),
 ('{"1":"521100"}','{"fr_FR":"BICIGUI - Compte courant"}','asset_cash'), ('{"1":"571100"}','{"fr_FR":"Caisse principale"}','asset_cash'),
 ('{"1":"443100"}','{"fr_FR":"TVA facturée"}','liability_current');
-- Facture client posted, partiellement payée
INSERT INTO account_move (name, state, move_type, journal_id, partner_id, date, invoice_date, invoice_date_due, payment_state, amount_untaxed_signed, amount_total_signed, amount_residual_signed)
VALUES ('FAC/2026/0001','posted','out_invoice',1,1,CURRENT_DATE-10,CURRENT_DATE-10,CURRENT_DATE+35,'partial',1000000000,1180000000,580000000),
       ('FAC/2026/0002','posted','out_invoice',1,2,CURRENT_DATE-40,CURRENT_DATE-40,CURRENT_DATE-5,'not_paid',500000000,590000000,590000000),
       ('FFO/2026/0001','posted','in_invoice',2,3,CURRENT_DATE-3,CURRENT_DATE-3,CURRENT_DATE+27,'not_paid',-200000000,-236000000,-236000000),
       ('BQ1/2026/0001','posted','entry',3,1,CURRENT_DATE-2,NULL,NULL,NULL,0,0,0);
INSERT INTO account_move_line (move_id, account_id, journal_id, partner_id, date, name, display_type, debit, credit, balance) VALUES
 (1,1,1,1,CURRENT_DATE-10,'FAC/2026/0001','payment_term',1180000000,0,1180000000),
 (1,3,1,1,CURRENT_DATE-10,'Transport Conakry-Siguiri','product',0,1000000000,-1000000000),
 (1,7,1,1,CURRENT_DATE-10,'TVA 18%','tax',0,180000000,-180000000),
 (2,1,1,2,CURRENT_DATE-40,'FAC/2026/0002','payment_term',590000000,0,590000000),
 (2,3,1,2,CURRENT_DATE-40,'Transport Conakry-Beyla','product',0,500000000,-500000000),
 (2,7,1,2,CURRENT_DATE-40,'TVA 18%','tax',0,90000000,-90000000),
 (3,2,2,3,CURRENT_DATE-3,'FFO/2026/0001','payment_term',0,236000000,-236000000),
 (3,4,2,3,CURRENT_DATE-3,'Gasoil 50 ppm','product',200000000,0,200000000),
 (3,7,2,3,CURRENT_DATE-3,'TVA déductible','tax',36000000,0,36000000),
 (4,5,3,1,CURRENT_DATE-2,'Encaissement TOTAL','payment_term',600000000,0,600000000),
 (4,1,3,1,CURRENT_DATE-2,'Encaissement TOTAL','payment_term',0,600000000,-600000000);
