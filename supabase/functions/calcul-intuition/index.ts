/*
 * The maintained Intuition implementation owns the shared access gate.
 */
import { handler } from '../calcul-intuition.ts';

Deno.serve(handler);
