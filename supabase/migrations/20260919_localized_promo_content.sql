-- Multilingual content for administrator-managed public banners.
--
-- The legacy title/description/action_label columns remain as French
-- fallbacks. The JSONB columns use locale codes as keys, for example:
-- {"fr":"Offre du jour","en":"Offer of the day","es":"Oferta del día"}.

alter table if exists public.promo_banners
  add column if not exists title_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_i18n jsonb not null default '{}'::jsonb,
  add column if not exists action_label_i18n jsonb not null default '{}'::jsonb;

comment on column public.promo_banners.title_i18n is
  'Localized banner titles keyed by locale code; title remains the French fallback.';
comment on column public.promo_banners.description_i18n is
  'Localized banner descriptions keyed by locale code.';
comment on column public.promo_banners.action_label_i18n is
  'Localized banner action labels keyed by locale code.';
