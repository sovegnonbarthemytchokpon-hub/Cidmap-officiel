-- Indexes for the reads the browser issues most often.
--
-- The public feed counts likes/shares per publication with
-- `.in('draw_id', [...])`, reads comment threads by draw_id ordered by
-- created_at, and the Croix archive reads the latest programme dates. Without
-- matching indexes each of those is a sequential scan, which is what turns a
-- high request count into high Disk I/O.
--
-- Additive and idempotent: every statement is guarded, nothing is rewritten.

do $$
begin
  if to_regclass('public.post_likes') is not null then
    execute 'create index if not exists post_likes_draw_user_idx
      on public.post_likes (draw_id, user_id)';
  end if;
  if to_regclass('public.post_shares') is not null then
    execute 'create index if not exists post_shares_draw_idx
      on public.post_shares (draw_id)';
  end if;
  if to_regclass('public.comments') is not null then
    execute 'create index if not exists comments_draw_created_idx
      on public.comments (draw_id, created_at)';
  end if;
  if to_regclass('public.comment_likes') is not null then
    execute 'create index if not exists comment_likes_comment_idx
      on public.comment_likes (comment_id)';
  end if;
  if to_regclass('public.croix_nationale_generations') is not null then
    execute 'create index if not exists croix_generations_programme_date_idx
      on public.croix_nationale_generations (programme_date desc)';
  end if;
end
$$;
