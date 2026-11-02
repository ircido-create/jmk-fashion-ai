-- Pausa da cobrança de CARLA CRISTINA CORREA AMORIM PEDROSO até 11/11/2026.
--
-- Em 30/10, junto com o comprovante de R$ 150,00, ela avisou no WhatsApp:
-- "fiquei um pouco apertada, me perdoa, fiz 150,00. No décimo já quito tudo".
-- Ficou devendo R$ 420,00 (R$ 70,00 de resto da parcela de 30/10 e R$ 350,00
-- que vencem em 15/11), e seguia recebendo cobrança automática todo dia por
-- algo que ela já tinha combinado.
--
-- A pausa é sem data no banco: o sistema só tem ligado/desligado. A loja
-- escolheu assim por ora, então alguém precisa religar a cobrança a partir do
-- dia 11 — o motivo abaixo fica no cadastro para lembrar.
UPDATE public.customers
   SET dunning_paused = true,
       dunning_pause_note = 'Pausada até 11/11/2026 — em 30/10 avisou no WhatsApp que ficou apertada, pagou R$ 150,00 e quita o restante no dia 10. Religar a cobrança a partir de 11/11.',
       updated_at = now()
 WHERE id = 'f4ede3bf-aff8-407a-a01d-5aaf263f6180';
