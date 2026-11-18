/*
 * The maintained LNB implementation owns the shared access gate.
 */
import { handler } from '../calcul-lnb.ts';

Deno.serve(handler);
