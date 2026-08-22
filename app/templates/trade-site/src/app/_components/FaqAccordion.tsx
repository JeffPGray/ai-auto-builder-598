"use client";

/**
 * Template FAQ accordion — shadcn Accordion restyled onto derived tokens.
 * Opus wires site-data FAQ items; do not hand-roll <details>.
 *
 * AEO contract (both lanes): type=multiple + defaultValue opens every item so
 * answers stay in static HTML. Closed Radix panels are display:none and fail
 * aeo-check "invisible FAQ answers". Do not revert to type=single.
 */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/_components/ui/accordion";

type FaqItem = { q: string; a: string };

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <Accordion
      type="multiple"
      defaultValue={items.map((item) => item.q)}
      className="w-full"
    >
      {items.map((item) => (
        <AccordionItem
          key={item.q}
          value={item.q}
          className="border-b border-surface-3 last:border-0"
        >
          <AccordionTrigger className="font-display py-5 text-left text-xl font-bold text-ink hover:no-underline hover:text-accent data-[state=open]:text-accent">
            {item.q}
          </AccordionTrigger>
          <AccordionContent className="font-body pb-6 text-base leading-relaxed text-ink-muted">
            {item.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
