# 10XBNB

One list. Two logins. The listing link is the property.

The page is this repo on GitHub Pages. The leads live in Supabase. This repo holds no leads.

## Once

1. Create a Supabase project on the free plan.
2. Run `sql/schema.sql` in the SQL editor.
3. Authentication → Email: turn off Confirm email. Turn off Allow new users to sign up.
4. Authentication → Hooks → Before user created: `public.hook_before_user_created`.
5. Create two users in the dashboard. Create a third user named for backup. Add each uuid:

```sql
insert into private.members (user_id, name) values ('<uuid>', 'levi');
insert into private.members (user_id, name) values ('<uuid>', 'lon');
insert into private.members (user_id, name) values ('<uuid>', 'backup');
```

6. Put the project URL and the anon key in `config.js`. Commit that file. The service key stays in the dashboard.
7. `python3 tools/seed.py` prints counts. `SUPABASE_URL` `SUPABASE_ANON_KEY` `SUPABASE_EMAIL` `SUPABASE_PASSWORD` `python3 tools/seed.py --commit` loads July. Do not save the workbook as CSV first. That drops the links.
8. Push `main`. Pages serves the root. The address is `https://leevzo.github.io/10xbnb-board/`. Do not rename the repo after the icon exists.
9. Copy `backup/nightly.yml` into a private repo's `.github/workflows/`. The job is the nightly encrypted export and the ping that keeps the free project awake.

## Phone

On a phone, open the page in the browser, add it to the home screen, then open the icon and sign in there. The browser and the icon do not share a login. Save the password when the phone asks.

A locked-out password is replaced in the Supabase dashboard and said on a call. There is no reset email.

## Check

`node --test`

`SUPABASE_URL=… SUPABASE_ANON_KEY=… sh tools/verify.sh`

Anon must return `[]`. Signup must not return 200.
