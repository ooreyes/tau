import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn's class combiner: clsx for conditional class
 * logic, tailwind-merge so a caller's utility (`p-2`) wins over a component
 * default (`p-4`) instead of colliding.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
