import { businessGraph } from "./schema";

/** Server component — ships business JSON-LD once from layout (bluegrass pattern). */
export default function BusinessJsonLd() {
  const json = JSON.stringify(businessGraph());
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
