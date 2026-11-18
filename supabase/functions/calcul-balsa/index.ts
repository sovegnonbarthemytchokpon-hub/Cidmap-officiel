/*
 * The Balsa server is self-contained in the parent file.
 */
import { handler } from '../calcul-balsa.ts';

Deno.serve(handler);
