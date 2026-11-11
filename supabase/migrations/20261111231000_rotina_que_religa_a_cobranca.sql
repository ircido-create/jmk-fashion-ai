-- Liga o despertador: todo dia às 09:30 a cobrança volta para quem chegou
-- na data combinada.
--
-- Depende da migração 20261111230000, que criou a coluna dunning_paused_until
-- e a função dunning_resume_due(). Sem este agendamento, a data fica só
-- registrada no cadastro e alguém precisa religar na mão.
--
-- 12:30 UTC = 09:30 em Brasília, meia hora antes do jmk-dunning-daily, que
-- manda as cobranças às 10h. A ordem importa: quem volta hoje tem de estar
-- liberado antes de a cobrança do dia ser montada.
--
-- Para desligar: SELECT cron.unschedule('jmk-dunning-resume');
SELECT cron.unschedule('jmk-dunning-resume')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jmk-dunning-resume');

SELECT cron.schedule('jmk-dunning-resume', '30 12 * * *',
                     $cron$SELECT public.dunning_resume_due();$cron$);
