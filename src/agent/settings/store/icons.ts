import { createElement } from 'react';
import {
  Bike,
  Briefcase,
  Calculator,
  CalendarClock,
  Code,
  GraduationCap,
  HeartPulse,
  House,
  LifeBuoy,
  Megaphone,
  Puzzle,
  Scale,
  ShoppingCart,
  Stethoscope,
  Truck,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

/** The icons a catalog may name; anything else shows the puzzle piece. */
const ICONS: Record<string, LucideIcon> = {
  bike: Bike,
  briefcase: Briefcase,
  calculator: Calculator,
  calendar: CalendarClock,
  code: Code,
  education: GraduationCap,
  health: HeartPulse,
  home: House,
  'life-buoy': LifeBuoy,
  marketing: Megaphone,
  legal: Scale,
  shop: ShoppingCart,
  clinic: Stethoscope,
  truck: Truck,
  food: Utensils,
};

/** The catalog's icon by name (a plain function, so the screen does not create a component per render). */
export function StoreIcon({ name, size }: { name: string; size: number }) {
  return createElement(ICONS[name] ?? Puzzle, { size });
}
