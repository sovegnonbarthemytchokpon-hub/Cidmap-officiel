/*
 * Keep the deployed entry point on the maintained implementation.
 *
 * The calculation source imports the shared access gate, which accepts:
 * - an active individual unlock;
 * - an active subscription whose plan contains this Tableau;
 * - an administrator role.
 */
import { handler } from '../calcul-universelle.ts';

Deno.serve(handler);
