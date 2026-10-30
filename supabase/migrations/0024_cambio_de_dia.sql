-- «El sábado en vez de derby vamos al gym»: un cambio puntual de un día también queda en el historial de cambios del plan.
alter table public.cambios_plan drop constraint if exists cambios_plan_tipo_check;
alter table public.cambios_plan add constraint cambios_plan_tipo_check
  check (tipo in ('pausa', 'frecuencia_gym', 'objetivo', 'deporte', 'experiencia', 'cambiar_dia'));
