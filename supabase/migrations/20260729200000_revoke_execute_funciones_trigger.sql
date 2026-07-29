-- ============================================================================
-- Revocar EXECUTE de las funciones de trigger (ADR-006, hallazgo del advisor
-- de seguridad 2026-07-29): PostgREST las exponía como RPC a anon/authenticated.
-- Como funciones de trigger no son explotables fuera de su contexto, pero no
-- tienen por qué estar en la API. Idempotente.
-- ============================================================================

revoke execute on function public.handle_nuevo_usuario() from anon, authenticated, public;
revoke execute on function public.handle_email_actualizado() from anon, authenticated, public;

-- `public.rls_auto_enable()` (no creada por nuestras migraciones — apareció en
-- el advisor el mismo día) se trata aparte cuando se aclare su origen.
