import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes safely: clsx handles conditionals, twMerge resolves
 * conflicting utilities (last one wins) so `cn('p-2', 'p-4')` => 'p-4'.
 *
 * Every component in components/ui/ imports this as `@/lib/utils`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
