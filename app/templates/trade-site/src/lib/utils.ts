import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui's class merge helper. Required by every generated component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
