/*
 * The maintained Oracle implementation owns the shared access gate.
 */
import { handler } from '../calcul-oracle.ts';

Deno.serve(handler);
